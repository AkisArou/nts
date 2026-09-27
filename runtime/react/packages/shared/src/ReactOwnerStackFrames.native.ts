// A native program keeps no record of its frames: an Error has no `stack`
// (nts refuses reading one), so an element's owner stack formats to nothing,
// as upstream's does when it finds no frame of the program's own.

export function formatOwnerStack(_error: Error): string {
  return "";
}
