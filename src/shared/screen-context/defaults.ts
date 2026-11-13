import type { ScreenContextConfig } from './types.ts';

export const DEFAULT_SCREEN_CONTEXT_CONFIG: ScreenContextConfig = {
  enabled: false,
  intervalSec: 300,
  persistSummary: false,
  blacklist: {
    titles: ['密码', 'Password', '银行', '支付', '钱包', '私密', '1Password', 'Bitwarden'],
    processes: ['KeePass', '1Password', 'Bitwarden'],
  },
};
