import * as React from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import makeStyles from '@mui/styles/makeStyles';
import JsonTreeView from '../JsonTreeView';

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
  return (
    <div>
      <Accordion
        disableGutters
        elevation={0}
        className={cls.accordion}
        defaultExpanded={defaultExpanded}
      >
        <AccordionSummary
          classes={{ root: cls.summary, content: cls.summaryContent }}
          expandIcon={<ExpandMoreIcon fontSize="small" />}
        >
          {icon && <span className={cls.icon}>{icon}</span>}
          <Typography className={cls.header}>{header}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <JsonTreeView
            className={textClassName}
            filterBasePath={filterBasePath}
            onFilterAdded={onFilterAdded}
          >
            {children as string}
          </JsonTreeView>
        </AccordionDetails>
      </Accordion>
    </div>
  );
};

export default AccordionJsonView;
