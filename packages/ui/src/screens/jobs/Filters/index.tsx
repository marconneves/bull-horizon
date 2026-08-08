import React from 'react';
import Paper from '@mui/material/Paper';
import { alpha } from '@mui/material/styles';
import makeStyles from '@mui/styles/makeStyles';
import { useQueueCounts } from './hooks';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import { OrderEnum } from '@/typings/gql';
import { useAtom } from 'jotai';
import { jobIdAtom, jobsOrderAtom } from '@/atoms/workspaces';
import DataSearch from './DataSearch';
import DataSearchTip from './DataSearch/Tip';
import { LIST_CARD_RADIUS } from '../List/constants';

const monospace = '"IBM Plex Mono", ui-monospace, monospace';

const useStyles = makeStyles((theme) => ({
  root: {
    marginBottom: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: LIST_CARD_RADIUS,
  },
  statuses: {
    display: 'flex',
    justifyContent: 'flex-start',
    maxWidth: '100%',
    overflowX: 'auto',
    flexWrap: 'nowrap',
    paddingBottom: theme.spacing(1.5),
    marginBottom: theme.spacing(1.5),
    borderBottom: `1px solid ${theme.palette.divider}`,
    scrollbarWidth: 'thin',
    '-webkit-overflow-scrolling': 'touch',
    '& > *': {
      marginRight: theme.spacing(1),
    },
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
    flexShrink: 0,
    padding: theme.spacing(0.5, 1.25),
    borderRadius: 999,
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background-color 120ms, border-color 120ms, color 120ms',
    textTransform: 'capitalize',
    backgroundColor: alpha(theme.palette.text.secondary, 0.08),
    border: `1px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
    '&:hover': {
      borderColor: theme.palette.text.disabled,
    },
  },
  pillActive: {
    backgroundColor: alpha(theme.palette.primary.main, 0.16),
    borderColor: theme.palette.primary.main,
    color: theme.palette.primary.main,
  },
  pillCount: {
    fontFamily: monospace,
    fontVariantNumeric: 'tabular-nums',
    borderRadius: 999,
    padding: theme.spacing(0, 0.75),
    backgroundColor: alpha(theme.palette.text.secondary, 0.14),
  },
  pillCountActive: {
    backgroundColor: alpha(theme.palette.primary.main, 0.22),
  },
  textFields: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    '& > *': {
      marginRight: theme.spacing(1.5),
      marginTop: theme.spacing(0.5),
    },
  },
  jobIdField: {
    '& input': {
      fontFamily: monospace,
    },
  },
  sortField: {
    minWidth: '90px',
  },
  dataSearchField: {
    flex: 1,
    minWidth: '300px',
  },
  dataSearchTip: {
    marginBottom: theme.spacing(1),
  },
}));

export default function JobsFilters() {
  const cls = useStyles();
  const counts = useQueueCounts();
  const [jobId, changeJobId] = useAtom(jobIdAtom);
  const [order, changeOrder] = useAtom(jobsOrderAtom);
  return (
    <Paper elevation={0} className={cls.root}>
      <div className={cls.statuses}>
        {counts.map(({ value, label, isActive, onClick }, idx) => (
          <div
            key={idx}
            onClick={onClick}
            className={`${cls.pill} ${isActive ? cls.pillActive : ''}`}
          >
            <span
              className={`${cls.pillCount} ${
                isActive ? cls.pillCountActive : ''
              }`}
            >
              {value}
            </span>
            {label}
          </div>
        ))}
      </div>
      <DataSearchTip className={cls.dataSearchTip} />
      <div className={cls.textFields}>
        <TextField
          className={cls.jobIdField}
          value={jobId}
          onChange={(e) => changeJobId(e.target.value)}
          label="Job ID"
          variant="outlined"
          id="jobs-filters_id"
          size="small"
        />
        <TextField
          variant="outlined"
          size="small"
          className={cls.sortField}
          value={order}
          onChange={(e) => {
            changeOrder(e.target.value as OrderEnum);
          }}
          select
          label="Order"
          id="jobs-filters_order"
        >
          <MenuItem value={OrderEnum.Desc}>DESC</MenuItem>
          <MenuItem value={OrderEnum.Asc}>ASC</MenuItem>
        </TextField>
        <DataSearch
          className={cls.dataSearchField}
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          }
        />
      </div>
    </Paper>
  );
}
