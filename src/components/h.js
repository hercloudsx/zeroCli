import React from 'react';
import htm from 'htm';

// JSX-like templates without a build step: html`<${Box}>…</${Box}>`
export const html = htm.bind(React.createElement);
