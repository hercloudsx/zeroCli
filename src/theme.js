// Colors mirror the Claude Code themes. `theme` is mutated in place by applyTheme()
// so every component picks up the new palette on its next render.
const DARK = {
  brand: '#D77757', // the signature orange
  brandShimmer: '#EB9F7F',
  permission: '#B1B9F9',
  permissionShimmer: '#CFD7FF',
  planMode: '#48968C',
  autoAccept: '#AF87FF',
  fullAuto: '#FFB454',
  bashBorder: '#FD5DB1',
  memory: '#7EB6F5',
  text: '#FFFFFF',
  inverseText: '#000000',
  inactive: '#999999',
  subtle: '#505050',
  suggestion: '#B1B9F9',
  remember: '#B1B9F9',
  success: '#4EBA65',
  error: '#FF6B80',
  warning: '#FFC107',
  secondaryText: '#999999',
  secondaryBorder: '#888888',
  diffAdded: '#225C2B',
  diffRemoved: '#7A2936',
  diffAddedDimmed: '#47584A',
  diffRemovedDimmed: '#69484D',
  diffAddedWord: '#38A660',
  diffRemovedWord: '#B3596B',
  userMessageBg: '#373737',
};

const LIGHT = {
  ...DARK,
  brandShimmer: '#F5A38A',
  permission: '#5769F7',
  permissionShimmer: '#8A99FF',
  planMode: '#006666',
  autoAccept: '#8700FF',
  fullAuto: '#C77400',
  bashBorder: '#FF0087',
  memory: '#2E7DD7',
  text: '#000000',
  inverseText: '#FFFFFF',
  inactive: '#666666',
  subtle: '#AFAFAF',
  suggestion: '#5769F7',
  remember: '#5769F7',
  success: '#2C7A39',
  error: '#AB2B3F',
  warning: '#966C1E',
  secondaryText: '#666666',
  secondaryBorder: '#999999',
  diffAdded: '#B5F0C0',
  diffRemoved: '#FFC9D1',
  diffAddedDimmed: '#D9F2DD',
  diffRemovedDimmed: '#F7E1E4',
  diffAddedWord: '#2C7A39',
  diffRemovedWord: '#AB2B3F',
  userMessageBg: '#F0F0F0',
};

export const THEMES = { dark: DARK, light: LIGHT };

export const theme = { ...DARK };

export function applyTheme(name) {
  Object.assign(theme, THEMES[name] ?? DARK);
}

export const APP_NAME = 'Zero Code';
export const VERSION = '0.1.0';
export const MASCOT_NAME = 'Zero-chan';
