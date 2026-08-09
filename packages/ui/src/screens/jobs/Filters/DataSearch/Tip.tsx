import React from 'react';
import CloseableTip from '@/components/CloseableTip';

type TProps = {
  className?: string;
};
const DataSearchTip = ({ className }: TProps) => {
  const text = (
    <>
      Search is powered by{' '}
      <a target="__blank" href="https://docs.jsonata.org/overview.html">
        jsonata
      </a>
      . Query the job itself — <code>data</code>, <code>opts</code>,{' '}
      <code>returnvalue</code>, <code>name</code> — or hit{' '}
      <code>&lt;&gt;</code> to build the filter visually.
    </>
  );
  return (
    <CloseableTip
      className={className}
      persistKey="data-text-search-v3"
      tip={text}
    />
  );
};
export default DataSearchTip;
