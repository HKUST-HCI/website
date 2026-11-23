# Website content update workflow

Run all commands from the website project root.

## Normal monthly update

```powershell
npm run update
```

This command checks Prof. Ma's configured source page and Google Scholar list,
keeps only content newer than the approved baseline, validates News against
the `src/data/people.json` Current Members group, validates publication first authors,
and opens the local Review page at `http://127.0.0.1:8766/review.html`.

Nothing is published before a reviewer approves it. Rejecting a batch records
the reason without changing the site. Approving a batch updates the approved
JSON baseline, synchronizes `src/data/news.json` and
`src/data/publications.json`, runs the normal project build, and opens the
refreshed page.

Publication approvals merge into the approved history. Synchronization merges those records into the existing publication list rather than replacing a whole year. DOI is used when available; otherwise the year and normalized title identify a paper. Existing images, links, and other metadata are retained when an update omits them.

The Review page shows the Scholar source separately from the DOI/publisher URL.
Published paper links use the DOI or venue URL; Scholar remains available as
the discovery source.

## Useful commands

```powershell
npm run update:scan       # stage a fresh incremental batch and open Review
npm run update:review     # reopen an existing Review batch
npm run update:enrich     # enrich staged publications with DOI/venue metadata
npm run update:validate   # validate the incremental baseline logic
npm run sync:approved     # sync already-approved JSON into src/data only
npm run build             # rebuild the site
```

The tracked baseline files are:

- `automation/data/approved-news.json`
- `automation/data/approved-publications.json`

The local `automation/data/audit.log`, transient review files, and metadata
caches are ignored by Git. Keep human approval deliberate; do not schedule an
unattended approval action.

## Tests

```sh
python3 -m unittest discover -s automation -p 'test_*.py' -v
```

The tests use temporary fixtures only and do not approve real data or access the network.
