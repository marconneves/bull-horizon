import React, { memo, useState, useCallback, useEffect } from 'react';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import BackspaceIcon from '@mui/icons-material/Backspace';
import CodeIcon from '@mui/icons-material/Code';
import makeStyles from '@mui/styles/makeStyles';
import clsx from 'clsx';
import { useDataSearchState } from './hooks';
import {
  useFieldSuggestions,
  useFilterBuilderState,
} from './FilterBuilder/hooks';
import FilterBuilder from './FilterBuilder';
import { usePreferencesStore } from '@/stores/preferences';

const useStyles = makeStyles((theme) => ({
  // In filter mode the rows take the full width of the bar; in query mode the
  // field keeps sharing its line with "Job ID" and "Order", as before.
  builder: {
    flexBasis: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
  },
  label: {
    flex: 1,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: theme.palette.text.secondary,
  },
}));

type TProps = {
  className?: string;
  startAdornment?: React.ReactNode;
};

const DataSearch = ({ className, startAdornment }: TProps) => {
  const cls = useStyles();
  const { search, onChange, onClear } = useDataSearchState();
  const { tree, setTree } = useFilterBuilderState();
  const suggestions = useFieldSuggestions();
  const visualJobFilter = usePreferencesStore((state) => state.visualJobFilter);
  const [isBuilder, setIsBuilder] = useState(visualJobFilter);

  // The preference sets the starting mode, and flipping it in Settings takes
  // effect right away. The `<>` button stays an ad-hoc override on top of it.
  useEffect(() => setIsBuilder(visualJobFilter), [visualJobFilter]);

  // `tree === null` = a valid expression outside the row grammar (array
  // predicate, a function other than $contains, ...). The toggle is disabled
  // rather than rewriting the user's query.
  const canBuild = tree !== null;
  const toggle = useCallback(() => setIsBuilder((v) => !v), []);

  const toggleButton = (
    <Tooltip
      title={
        !canBuild
          ? 'Advanced expression — editable as text only'
          : isBuilder
          ? 'Edit as query'
          : 'Edit as filters'
      }
    >
      {/* span because Tooltip doesn't fire on a disabled button */}
      <span>
        <IconButton size="small" onClick={toggle} disabled={!canBuild}>
          <CodeIcon
            fontSize="small"
            color={isBuilder ? 'primary' : undefined}
          />
        </IconButton>
      </span>
    </Tooltip>
  );

  if (isBuilder && tree) {
    return (
      <div className={clsx(className, cls.builder)}>
        <div className={cls.header}>
          {toggleButton}
          <Typography className={cls.label}>Filters</Typography>
          <Tooltip title="Clear">
            <IconButton onClick={onClear} size="small">
              <BackspaceIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
        <FilterBuilder
          tree={tree}
          suggestions={suggestions}
          onChange={setTree}
        />
      </div>
    );
  }

  return (
    <TextField
      className={className}
      value={search}
      onChange={onChange}
      label="Search"
      variant="outlined"
      id="jobs-filters_data-search-key"
      autoComplete="off"
      size="small"
      InputProps={{
        startAdornment: (
          <>
            {toggleButton}
            {startAdornment}
          </>
        ),
        endAdornment: (
          <Tooltip title="Clear">
            <IconButton onClick={onClear} size="small">
              <BackspaceIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      }}
    />
  );
};
export default memo(DataSearch);
