import React from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import logo from '@/assets/logo.png';

type TProps = {
  width?: string | number;
  fill?: string;
};

const Logo = ({ width = 130, fill = 'inherit' }: TProps) => {
  const theme = useTheme();
  return (
    <Box display="flex" alignItems="center" gap={1} width={width}>
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        width={28}
        height={28}
        borderRadius={1.5}
        flexShrink={0}
        bgcolor={theme.palette.action.selected}
      >
        <img src={logo} alt="" width={17} height={17} />
      </Box>
      <Box
        component="span"
        fontSize={17}
        fontWeight={600}
        letterSpacing="-0.005em"
        color={fill}
        whiteSpace="nowrap"
      >
        Bull
        <Box component="span" color={theme.palette.primary.main}>
          Horizon
        </Box>
      </Box>
    </Box>
  );
};

export default Logo;
