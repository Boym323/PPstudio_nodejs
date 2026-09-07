import { AdminRole } from "@/generated/prisma/browser";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { type AdminArea, getAdminHomeHref } from "@/config/navigation";
import { verifyPassword } from "@/lib/auth/password";
import {
  createSessionToken as createSessionTokenInternal,
  getSessionCookie as getSessionCookieConfig,
  shouldRejectSessionForAbsoluteAge,
  verifySessionToken as verifySessionTokenInternal,
  type SessionTokenPayload,
} from "@/lib/auth/session-token";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = getSessionCookieConfig().name;

type SessionPayload = SessionTokenPayload;

export type AdminSession = SessionPayload;

export async function authenticateAdmin(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const dbUser = await prisma.adminUser.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      passwordHash: true,
    },
  });

  if (dbUser?.passwordHash) {
    if (!dbUser.isActive) {
      return null;
    }

    const isPasswordValid = await verifyPassword(password, dbUser.passwordHash);

    if (!isPasswordValid) {
      return null;
    }

    await prisma.adminUser.update({
      where: {
        id: dbUser.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });

    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
    };
  }

  return null;
}

export async function createSessionToken(payload: SessionPayload) {
  return createSessionTokenInternal(payload);
}

export async function verifySessionToken(token: string) {
  return verifySessionTokenInternal(token);
}

export async function resolveSessionFromTokenValue(token: string): Promise<AdminSession | null> {
  let tokenPayload: SessionPayload;

  try {
    tokenPayload = await verifySessionToken(token);
  } catch {
    return null;
  }

  if (
    !tokenPayload.sub
    || shouldRejectSessionForAbsoluteAge(tokenPayload, Math.floor(Date.now() / 1000))
  ) {
    return null;
  }

  const dbUser = await prisma.adminUser.findUnique({
    where: {
      id: tokenPayload.sub,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  if (!dbUser?.isActive) {
    return null;
  }

  return {
    sub: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return resolveSessionFromTokenValue(token);
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    redirect("/admin/prihlaseni");
  }

  return session;
}

export async function requireRole(allowedRoles: AdminRole[]) {
  const session = await requireSession();

  if (!allowedRoles.includes(session.role)) {
    redirect(getAdminHomeHref(session.role));
  }

  return session;
}

export async function requireAdminArea(area: AdminArea) {
  if (area === "owner") {
    return requireRole([AdminRole.OWNER]);
  }

  return requireRole([AdminRole.OWNER, AdminRole.SALON]);
}

export function getSessionCookie() {
  return getSessionCookieConfig();
}
