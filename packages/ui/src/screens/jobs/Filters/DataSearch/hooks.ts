import React, {
  useCallback,
  useMemo,
  useState,
  useRef,
  useEffect,
} from 'react';
import debounce from 'lodash/debounce';
import { dataSearchAtom, clearDataSearchAtom } from '@/atoms/workspaces';
import { useUpdateAtom } from 'jotai/utils';
import { useAtom } from 'jotai';
import { useToast } from '@/hooks/use-toast';

const SEARCH_INPUT_DEBOUNCE = 250;
export const useDataSearchState = () => {
  const [search, setSearch] = useState('');
  const [atomSearch, changeAtomSearch] = useAtom(dataSearchAtom);
  const clear = useUpdateAtom(clearDataSearchAtom);
  const onClear = useCallback(() => {
    clear();
    setSearch('');
  }, []);
  useEffect(() => {
    if (!isDebouncingRef.current) {
      setSearch(atomSearch);
    }
  }, [atomSearch]);
  const isDebouncingRef = useRef(false);
  const onChange: React.ChangeEventHandler<HTMLInputElement> = useMemo(() => {
    const debounced = debounce((v: string) => {
      isDebouncingRef.current = false;
      changeAtomSearch(v);
    }, SEARCH_INPUT_DEBOUNCE);
    return ({ target: { value } }) => {
      isDebouncingRef.current = true;
      setSearch(value);
      debounced(value);
    };
  }, []);
  return {
    onClear,
    search,
    onChange,
  };
};

// Appends a jsonata clause built from a clicked JSON field (see
// JsonTreeView/AccordionJsonView) to the current data search — combining
// with `and` when a filter is already present, so clicking a couple of
// fields in a row builds up a query the same way the docs' examples do.
export const useAddDataSearchFilter = () => {
  const [current, setSearch] = useAtom(dataSearchAtom);
  const toast = useToast();
  return useCallback(
    (clause: string) => {
      setSearch(current ? `${current} and ${clause}` : clause);
      toast('Added to filter', { variant: 'success', autoHideDuration: 2000 });
    },
    [current, setSearch, toast]
  );
};
