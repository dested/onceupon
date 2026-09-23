// Metro turns a required/imported asset into a numeric module id. The bundled studio ships as
// studio.html. This pattern is deliberately more specific than @types/bun's `*.html` (which types
// the import as an HTMLBundle) so the Metro/RN meaning wins for our asset.
declare module '*studio.html' {
  const asset: number
  export default asset
}
