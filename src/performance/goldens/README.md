# Golden fixtures

Recorded outputs of the Relationship Engine and of search ranking, over the same
seeded random datasets the executable oracles used during V1-R2 and V1-R6.

## Why these exist

While a package is actively changing a subsystem, the strongest safety net is a
frozen *copy of the implementation*: it can be run against any input, including
inputs nobody has thought of yet. That is what `__legacy.engine.ts` and
`__legacy.personSearch.ts` were, and they earned their keep — between them they
caught a tie-break regression, a tier swap and a dropped match source.

Once the work is done, that duplicate stops paying for itself and starts
rotting: it imports domain modules that keep moving, and a second copy of
ranking logic is exactly the kind of parallel concept this codebase tries not to
accumulate. So at the end of V1-R6 both copies were replaced by their recorded
outputs. The standing pattern is:

> An executable oracle for the duration of the work that needs it; golden
> fixtures as the permanent regression net.

## What is checked

`goldens.test.ts` regenerates the same datasets from the same seeds and compares
against these files. A change to engine projections or to search ranking — what
is found, in what order, with what explanation — fails the build.

## When a golden legitimately changes

Only when a deliberate behaviour change was made. Regenerate with:

```
PEOPLEOS_UPDATE_GOLDENS=1 npx vitest run src/performance/goldens.test.ts
```

Then **read the diff**. It is the specification of what you just changed to
every user's search results and Today queue. A regenerated golden committed
without a reviewed diff removes the only thing protecting this behaviour.
