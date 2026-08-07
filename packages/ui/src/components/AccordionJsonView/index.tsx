import * as React from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import JsonTreeView from '../JsonTreeView';

type TProps = {
  header: string;
  textClassName?: string;
  defaultExpanded?: boolean;
  filterBasePath?: string;
  onFilterAdded?: (expression: string) => void;
};
const AccordionJsonView: React.FC<TProps> = (props) => {
  const {
    children,
    header,
    textClassName,
    defaultExpanded = true,
    filterBasePath,
    onFilterAdded,
  } = props;
  return (
    <div>
      <Accordion defaultExpanded={defaultExpanded}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>{header}</Typography>
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

