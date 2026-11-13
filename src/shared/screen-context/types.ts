export type ScreenContextStatus = 'ok' | 'skipped' | 'error' | 'expired' | 'idle';

export type ScreenContextState = {
  status: ScreenContextStatus;
  text: string;
  updatedAt: number;
  errorMessage?: string;
};

export type ScreenContextConfig = {
  enabled: boolean;
  intervalSec: number;
  blacklist: {
    titles: string[];
    processes: string[];
  };
  persistSummary: boolean;
};
