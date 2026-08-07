import React from 'react';
import Box from '@mui/material/Box';
import logo from '@/assets/logo.png';

type TProps = {
  width?: string | number;
  fill?: string;
};

const Logo = ({ width = 130, fill = 'white' }: TProps) => (
  <Box display="flex" alignItems="center" gap={1} width={width}>
    <img src={logo} alt="Bull Horizon" width={24} height={24} />
    <Box
      component="span"
      fontSize={18}
      fontWeight={500}
      color={fill}
      whiteSpace="nowrap"
    >
      Bull Horizon
    </Box>
  </Box>
);

export default Logo;
