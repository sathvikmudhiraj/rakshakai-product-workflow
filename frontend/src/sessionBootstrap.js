export async function restoreAuthenticatedView({
  checkSession,
  requestedView,
  setView,
  refresh,
  onRefreshError = () => {}
}) {
  const hasSession = await checkSession();
  if (!hasSession) return false;

  // Restore the deep link as soon as authentication is known. A transient
  // dashboard/API refresh failure must not send the signed-in user to login.
  setView(requestedView());
  try {
    await refresh();
  } catch (error) {
    if (error?.status === 401) throw error;
    onRefreshError(error);
  }
  return true;
}
