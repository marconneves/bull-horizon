import React, { memo, useCallback } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { alpha } from '@mui/material/styles';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import RemoveIcon from '@mui/icons-material/Remove';
import AddIcon from '@mui/icons-material/Add';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { OPERATOR_LABELS, inferValueKind } from '@/services/jsonata-filter';
import type {
  TFilterCondition,
  TFilterGroup,
  TFilterNode,
  TFilterOperator,
} from '@/services/jsonata-filter';
import { TreeOps } from './tree-ops';

const OPERATORS = Object.keys(OPERATOR_LABELS) as TFilterOperator[];

const useStyles = makeStyles((theme) => ({
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  },
  nested: {
    marginLeft: theme.spacing(1),
    paddingLeft: theme.spacing(1),
    borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.35)}`,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  },
  connector: {
    minWidth: 52,
    flexShrink: 0,
    padding: theme.spacing(0.25, 0.75),
    borderRadius: 4,
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textAlign: 'center',
    cursor: 'pointer',
    userSelect: 'none',
    border: `1px solid ${theme.palette.divider}`,
    color: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.1),
    '&:hover': {
      borderColor: theme.palette.primary.main,
    },
  },
  connectorSpacer: {
    minWidth: 52,
    flexShrink: 0,
  },
  pathField: {
    flex: 2,
    minWidth: 140,
  },
  operatorField: {
    width: 108,
    flexShrink: 0,
  },
  valueField: {
    flex: 3,
    minWidth: 120,
  },
  actions: {
    display: 'flex',
    flexShrink: 0,
  },
  mono: {
    '& input': {
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      fontSize: 12,
    },
  },
}));

type TRowProps = {
  condition: TFilterCondition;
  suggestions: string[];
  onChange: (patch: Partial<TFilterCondition>) => void;
};

const ConditionRow = ({ condition, suggestions, onChange }: TRowProps) => {
  const cls = useStyles();
  return (
    <>
      <Autocomplete
        freeSolo
        disablePortal
        className={`${cls.pathField} ${cls.mono}`}
        options={suggestions}
        value={condition.path}
        onChange={(_e, value) => onChange({ path: value ?? '' })}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            variant="outlined"
            placeholder="data.order.status"
            onChange={(e) => onChange({ path: e.target.value })}
          />
        )}
      />
      <TextField
        select
        size="small"
        variant="outlined"
        className={cls.operatorField}
        value={condition.operator}
        onChange={(e) =>
          onChange({ operator: e.target.value as TFilterOperator })
        }
      >
        {OPERATORS.map((op) => (
          <MenuItem key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        variant="outlined"
        placeholder="value"
        className={`${cls.valueField} ${cls.mono}`}
        value={condition.value}
        onChange={(e) =>
          onChange({
            value: e.target.value,
            // Numbers and booleans go unquoted into jsonata; text is quoted.
            valueKind: inferValueKind(e.target.value),
          })
        }
      />
    </>
  );
};

type TGroupProps = {
  group: TFilterGroup;
  root: TFilterGroup;
  isRoot: boolean;
  suggestions: string[];
  onChange: (next: TFilterGroup) => void;
};

const FilterGroup = ({
  group,
  root,
  isRoot,
  suggestions,
  onChange,
}: TGroupProps) => {
  const cls = useStyles();

  const toggleConnector = useCallback(() => {
    onChange(
      TreeOps.update(root, group.id, {
        connector: group.connector === 'and' ? 'or' : 'and',
      })
    );
  }, [root, group.id, group.connector, onChange]);

  return (
    <div className={`${cls.group} ${isRoot ? '' : cls.nested}`}>
      {group.children.map((child: TFilterNode, idx: number) => (
        <div className={cls.row} key={child.id}>
          {idx === 0 ? (
            <span className={cls.connectorSpacer} />
          ) : (
            <Tooltip title="Toggle AND/OR">
              <span className={cls.connector} onClick={toggleConnector}>
                {group.connector.toUpperCase()}
              </span>
            </Tooltip>
          )}

          {child.kind === 'condition' ? (
            <ConditionRow
              condition={child}
              suggestions={suggestions}
              onChange={(patch) =>
                onChange(TreeOps.update(root, child.id, patch))
              }
            />
          ) : (
            <FilterGroup
              group={child}
              root={root}
              isRoot={false}
              suggestions={suggestions}
              onChange={onChange}
            />
          )}

          <span className={cls.actions}>
            <Tooltip title="Remove">
              <IconButton
                size="small"
                onClick={() => onChange(TreeOps.remove(root, child.id))}
              >
                <RemoveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {idx === group.children.length - 1 && (
              <>
                <Tooltip title="Add filter">
                  <IconButton
                    size="small"
                    onClick={() => onChange(TreeOps.addCondition(root, group.id))}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Add group">
                  <IconButton
                    size="small"
                    onClick={() => onChange(TreeOps.addGroup(root, group.id))}
                  >
                    <AccountTreeIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </span>
        </div>
      ))}

      {!group.children.length && (
        <div className={cls.row}>
          <span className={cls.connectorSpacer} />
          <Tooltip title="Add filter">
            <IconButton
              size="small"
              onClick={() => onChange(TreeOps.addCondition(root, group.id))}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      )}
    </div>
  );
};

type TProps = {
  tree: TFilterGroup;
  suggestions: string[];
  onChange: (next: TFilterGroup) => void;
};

const FilterBuilder = ({ tree, suggestions, onChange }: TProps) => (
  <FilterGroup
    group={tree}
    root={tree}
    isRoot
    suggestions={suggestions}
    onChange={onChange}
  />
);

export default memo(FilterBuilder);
