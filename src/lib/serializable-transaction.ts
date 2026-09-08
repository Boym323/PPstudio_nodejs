import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export const SERIALIZABLE_TRANSACTION_MAX_RETRIES = 4;
const RETRY_DELAY_MS = 40;

function isSerializableConflict(error: unknown) {
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : null;

  return (
    (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) ||
    (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2010" &&
      /Code: [`']40001[`']/.test(error.message)
    ) ||
    (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "DriverAdapterError" &&
      typeof cause === "object" &&
      cause !== null &&
      "kind" in cause &&
      cause.kind === "TransactionWriteConflict"
    )
  );
}

function waitForRetry(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Opakuje pouze PostgreSQL serializační konflikty; ostatní chyby propouští beze změny. */
export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { onRetry?: (retryNumber: number, error: unknown) => void } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializableConflict(error) || attempt >= SERIALIZABLE_TRANSACTION_MAX_RETRIES) {
        throw error;
      }

      options.onRetry?.(attempt + 1, error);
      await waitForRetry(RETRY_DELAY_MS * (attempt + 1));
    }
  }
}
