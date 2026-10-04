// Ink only loads react-devtools-core when DEV=true. The standalone build ships this
// no-op stand-in so the bundle has no missing optional dependency.
const devtools = { initialize() {}, connectToDevTools() {} };
export default devtools;
export const { initialize, connectToDevTools } = devtools;
