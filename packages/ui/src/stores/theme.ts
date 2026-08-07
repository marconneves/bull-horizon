import { useMemo } from 'react';
import createStore from 'zustand';
import { createTheme } from '@mui/material/styles';
import { persist } from 'zustand/middleware';
import { StorageConfig } from '@/config/storage';

import {
  deepPurple,
  deepOrange,
  blue,
  indigo,
  pink,
  teal,
  amber,
  lightBlue,
  red,
  lightGreen,
  blueGrey,
  brown,
  cyan,
  yellow,
  grey,
} from '@mui/material/colors';

// Bull Horizon's brand accent — a muted "instrument panel" amber, warmer and
// less saturated than MUI's stock `amber` swatch (which reads more like a
// traffic-signal yellow). Shaped like `@mui/material/colors`' Color type so
// it plugs into the same `augmentColor` derivation (main from 500, light
// from 300, dark from 700) as every other entry in this map.
const horizon = {
  50: '#fdf6ec',
  100: '#f8e7cb',
  200: '#f0ce93',
  300: '#f0b356',
  400: '#e8aa47',
  500: '#e3a13a',
  600: '#d0912f',
  700: '#b87a22',
  800: '#9c6419',
  900: '#7a4c10',
  A100: '#ffdca8',
  A200: '#ffc670',
  A400: '#ffb03d',
  A700: '#ff9e1f',
};

const palettesMap = {
  horizon,
  deepPurple,
  deepOrange,
  blue,
  indigo,
  pink,
  teal,
  amber,
  red,
  lightBlue,
  lightGreen,
  blueGrey,
  brown,
  grey,
  cyan,
  yellow,
};

// Warm-graphite dark surface, layered over whichever accent is selected —
// independent of the primary color picker below, so switching accents
// doesn't bounce the app back to MUI's default near-black.
const DARK_SURFACE = {
  background: { default: '#15130e', paper: '#1b1810' },
  text: {
    primary: '#f2ecdd',
    secondary: '#a79c86',
    disabled: '#6b6353',
  },
  divider: 'rgba(244, 228, 193, 0.09)',
};
type TTheme = 'light' | 'dark';
type TPalette = keyof typeof palettesMap;
export const SUPPORTED_PALETTES = Object.keys(palettesMap) as TPalette[];
type TState = {
  theme: TTheme;
  palette: TPalette;

  changeTheme: (theme: TTheme) => void;
  toggleTheme: () => void;
  changePalette: (palette: TPalette) => void;
};

export const useThemeStore = createStore<TState>(
  persist(
    (set) => ({
      palette: 'horizon',
      theme: 'dark',
      changeTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
      changePalette: (palette) => set({ palette }),
    }),
    {
      name: `${StorageConfig.persistNs}theme`,
    }
  )
);
export const getMuiTheme = () => {
  const [theme, palette] = useThemeStore((state) => [
    state.theme,
    state.palette,
  ]);
  return useMemo(
    () =>
      createTheme({
        palette: {
          primary: palettesMap[palette],
          secondary: red,
          mode: theme,
          ...(theme === 'dark' ? DARK_SURFACE : {}),
        },
        typography: {
          fontFamily: ['"IBM Plex Sans"', '-apple-system', 'sans-serif'].join(
            ','
          ),
        },
      }),
    [theme, palette]
  );
};
