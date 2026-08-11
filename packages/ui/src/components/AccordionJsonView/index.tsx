import * as React from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import CopyIcon from '@mui/icons-material/ContentCopy';
import makeStyles from '@mui/styles/makeStyles';
import JsonTreeView from '../JsonTreeView';
import type { TExpandSignal } from '../JsonTreeView/JsonNode';
import { copyToClipboard } from '@/services/clipboard';
import { useToast } from '@/hooks/use-toast';

const useStyles = makeStyles((theme) => ({
  accordion: {
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: `${theme.shape.borderRadius}px !important`,
    overflow: 'hidden',
    '&:before': {
      display: 'none',
    },
  },
  summary: {
    minHeight: 40,
    '&.Mui-expanded': {
      minHeight: 40,
    },
  },
  summaryContent: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    margin: `${theme.spacing(0.75)} 0 !important`,
  },
  icon: {
    display: 'flex',
    color: theme.palette.text.secondary,
  },
  header: {
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  actionBtn: {
    padding: 4,
    color: theme.palette.text.secondary,
    '&:hover': {
      color: theme.palette.text.primary,
    },
  },
}));

type TProps = {
  header: string;
  icon?: React.ReactNode;
  textClassName?: string;
  defaultExpanded?: boolean;
  filterBasePath?: string;
  onFilterAdded?: (expression: string) => void;
};
const AccordionJsonView: React.FC<TProps> = (props) => {
  const {
    children,
    header,
    icon,
    textClassName,
    defaultExpanded = true,
    filterBasePath,
    onFilterAdded,
  } = props;
  const cls = useStyles();
  const toast = useToast();
  const payload = children as string;
  const [expandSignal, setExpandSignal] = React.useState<TExpandSignal>();
  // Controlled so "expand all" can open the card itself. Seeded once, like the
  // uncontrolled `defaultExpanded` it replaces.
  const [cardOpen, setCardOpen] = React.useState(defaultExpanded);

  // Only a JSON object/array has branches worth expanding; a plain-text return
  // value or a stacktrace is a flat block, so the control would do nothing.
  const isTree = React.useMemo(() => {
    try {
      const parsed = JSON.parse(payload);
      return typeof parsed === 'object' && parsed !== null;
    } catch (_e) {
      return false;
    }
  }, [payload]);

  const allExpanded = expandSignal?.open ?? false;
  const toggleExpandAll = React.useCallback((e: React.MouseEvent) => {
    // The summary is the accordion's own toggle; without this the card
    // collapses on the way out.
    e.stopPropagation();
    setExpandSignal((prev) => {
      const open = !(prev?.open ?? false);
      // Expanding every branch of a card that is itself collapsed looks like
      // a dead button, so the card comes along.
      if (open) setCardOpen(true);
      return { open, nonce: (prev?.nonce ?? 0) + 1 };
    });
  }, []);

  const copy = React.useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      // Re-serialize when it parses, so what lands on the clipboard is
      // formatted JSON rather than the single-line blob the API returned.
      let text = payload;
      try {
        text = JSON.stringify(JSON.parse(payload), null, 2);
      } catch (_e) {
        // Not JSON — copy it verbatim.
      }
      const ok = await copyToClipboard(text);
      toast(ok ? `${header} copied` : 'Could not copy to clipboard', {
        variant: ok ? 'success' : 'error',
      });
    },
    [payload, header, toast]
  );

  return (
    <div>
      <Accordion
        disableGutters
        elevation={0}
        className={cls.accordion}
        expanded={cardOpen}
        onChange={(_e, isExpanded) => setCardOpen(isExpanded)}
      >
        <AccordionSummary
          classes={{ root: cls.summary, content: cls.summaryContent }}
          expandIcon={<ExpandMoreIcon fontSize="small" />}
        >
          {icon && <span className={cls.icon}>{icon}</span>}
          <Typography className={cls.header}>{header}</Typography>
          <span className={cls.actions}>
            {isTree && (
              <Tooltip title={allExpanded ? 'Collapse all' : 'Expand all'}>
                <IconButton
                  className={cls.actionBtn}
                  size="small"
                  onClick={toggleExpandAll}
                  aria-label={allExpanded ? 'collapse all' : 'expand all'}
                >
                  {allExpanded ? (
                    <UnfoldLessIcon fontSize="small" />
                  ) : (
                    <UnfoldMoreIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Copy">
              <IconButton
                className={cls.actionBtn}
                size="small"
                onClick={copy}
                aria-label={`copy ${header}`}
              >
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </span>
        </AccordionSummary>
        <AccordionDetails>
          <JsonTreeView
            className={textClassName}
            filterBasePath={filterBasePath}
            onFilterAdded={onFilterAdded}
            expandSignal={expandSignal}
          >
            {payload}
          </JsonTreeView>
        </AccordionDetails>
      </Accordion>
    </div>
  );
};

export default AccordionJsonView;
