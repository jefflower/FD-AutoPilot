import React from 'react';
import { createPortal } from 'react-dom';
import { useJsonPreviewInternal } from './JsonPreviewContext';
import JsonPreviewPanel from './JsonPreviewPanel';

/**
 * Renders all open JSON preview panels into a portal on document.body.
 * Mounted internally by JsonPreviewProvider -- not used directly.
 */
const JsonPreviewContainer: React.FC = () => {
  const { panels } = useJsonPreviewInternal();

  if (panels.length === 0) return null;

  return createPortal(
    <>
      {panels.map(panel => (
        <JsonPreviewPanel key={panel.id} panel={panel} />
      ))}
    </>,
    document.body
  );
};

export default JsonPreviewContainer;
