// Both release lines read the shared key. Adopt preferences saved by the
// earlier Shiori client so subsequent writes by either release stay visible.
export function adoptBrowserPreference(storage: Storage, sharedKey: string, earlierKey: string) {
  const value = storage.getItem(earlierKey);
  if (value === null) return;
  storage.setItem(sharedKey, value);
  storage.removeItem(earlierKey);
}
