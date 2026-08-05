import type { StatusPayload } from "./api";

/** Props every top-level page receives from the app shell. */
export type PageProps = {
  status: StatusPayload | null;
  refreshStatus: () => void;
};
