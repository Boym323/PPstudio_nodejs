import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsActionsPath = new URL("./settings-actions.ts", import.meta.url);

async function actionSource() {
  return readFile(settingsActionsPath, "utf8");
}

test("denní AUTO/OFF používá oprávnění volných termínů pro OWNER i SALON", async () => {
  const source = await actionSource();
  const action = source.slice(
    source.indexOf("export async function updateAutoLunchDayModeAction"),
    source.indexOf("export async function updateEmailSettingsAction"),
  );

  assert.match(source, /area: z\.enum\(\["owner", "salon"\]\)/);
  assert.match(source, /getCurrentPlannerDbUser\(area: AdminArea\)[\s\S]*requireAdminSectionAccess\(area, "volne-terminy"\)/);
  assert.match(action, /getCurrentPlannerDbUser\(parsed\.data\.area\)/);
  assert.doesNotMatch(action, /getCurrentOwnerDbUser/);
  assert.match(action, /persistAutoLunchDayMode\(tx, \{[\s\S]*actor,/);
  assert.match(await readFile(new URL("../lib/admin-auto-lunch.ts", import.meta.url), "utf8"), /actorRole: input\.actor\.role, adminArea: input\.area/);
});

test("globální autoLunchEnabled zůstává v OWNER nastavení", async () => {
  const source = await actionSource();
  const bookingSettingsAction = source.slice(source.indexOf("export async function updateBookingSettingsAction"), source.indexOf("export async function updateAutoLunchDayModeAction"));

  assert.match(bookingSettingsAction, /const actorUserId = await getActorUserId\(\)/);
  assert.match(source, /async function getActorUserId\(\)[\s\S]*requireAdminSectionAccess\("owner", "nastaveni"\)/);
});

test("AUTO a OFF porovnávají a zapisují override atomicky v serializovatelné transakci", async () => {
  const source = await actionSource();
  const action = source.slice(
    source.indexOf("export async function updateAutoLunchDayModeAction"),
    source.indexOf("export async function updateEmailSettingsAction"),
  );

  assert.match(action, /runSerializableTransaction\(\(tx\) => persistAutoLunchDayMode\(tx, \{/);
  const mutationSource = await readFile(new URL("../lib/admin-auto-lunch.ts", import.meta.url), "utf8");
  assert.match(mutationSource, /if \(\(input\.mode === "OFF"\) === Boolean\(previous\)\) \{[\s\S]*return false/);
  assert.match(mutationSource, /export async function persistAutoLunchDayMode[\s\S]*tx\.autoLunchDayOverride\.findUnique/);
  assert.match(mutationSource, /persistAutoLunchDayMode[\s\S]*autoLunchDayOverride\.upsert\(/);
  assert.match(mutationSource, /persistAutoLunchDayMode[\s\S]*tx\.autoLunchDayOverride\.delete\(\{ where: \{ dateKey: input\.dateKey \} \}\)/);
  assert.doesNotMatch(action, /const previous = await prisma\.autoLunchDayOverride/);
});
