// Shapes the dashboard views share with DashboardApp, which owns the toast and the confirm dialog.

/** A short message shown at the top of the dashboard. */
export type Notice = { kind: "success" | "error"; text: string };

/** A question asked in the confirm dialog before something is done. */
export type ConfirmRequest = { title: string; message: string; confirmLabel?: string; danger?: boolean; action: () => void | Promise<void> };

export type Notify = (notice: Notice) => void;
export type Ask = (request: ConfirmRequest) => void;

/** The signed-in account, as far as the views need it. */
export type Viewer = { username: string; displayName?: string } | null;

/** The text to show for a caught error. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
