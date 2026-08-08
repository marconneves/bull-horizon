import React, { memo } from 'react';
import TablePagination from '@mui/material/TablePagination';
import { usePaginationStore } from '@/stores/pagination';
import { useCount } from './hooks';
import { PaginationConfig } from '@/config/pagination';
import makeStyles from '@mui/styles/makeStyles';
import { useAtom } from 'jotai';
import { activePageAtom } from '@/atoms/workspaces';
import { LIST_CARD_RADIUS } from '../constants';

const useStyles = makeStyles((theme) => ({
  root: {
    position: 'sticky',
    bottom: 0,
    backgroundColor: theme.palette.background.paper,
    zIndex: 2,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: LIST_CARD_RADIUS,
  },
}));

const Pagination = () => {
  const cls = useStyles();
  const [page, changePage] = useAtom(activePageAtom);
  const { perPage, changePerPage } = usePaginationStore();
  const count = useCount();
  return (
    <TablePagination
      className={cls.root}
      rowsPerPageOptions={PaginationConfig.perPageOptions}
      component="div"
      count={count}
      rowsPerPage={perPage}
      page={page}
      labelRowsPerPage="Per page"
      onPageChange={(_e, p) => changePage(p)}
      onRowsPerPageChange={(e) => changePerPage(Number(e.target.value))}
    />
  );
};
export default memo(Pagination);
