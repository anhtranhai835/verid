# Sample reheat adapter

A fake legacy format: `legacy/<unit>/screen.json` holds a screen's title and its behaviours. The
adapter lists each folder as a unit, copies its `screen.json` into the unit's dossier, and gates the
unit's spec on mentioning every behaviour's input. See [reheat mode](../../../docs/reheat-mode.md).

```sh
cp -r path/to/verid/examples/adapters/sample/legacy ./legacy
verid cook --mode reheat --legacy legacy
verid plugin add file:path/to/verid/examples/adapters/sample
verid reheat inventory
verid reheat extract calc
```
