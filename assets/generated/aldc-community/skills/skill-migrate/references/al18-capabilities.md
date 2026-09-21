# AL18 / BC29 capability checks

Read only for a BC29 migration or a requirement that needs one of these features.
Check the project's declared runtime and the actual compiler, target packages and
BC environment before using a new construct. Never enable every feature by default.
Do not change development-agent models because BC's in-product agents change.

Checked 2026-09-11 against the
[BC29 public-preview overview](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/whatsnew/whatsnew-update-29-0).
That page confirms broad capabilities for isolation, test lifecycle handlers,
namespace-aware translations and the AL0926 diagnostic. It does not provide all
exact declarations listed in the supplied handoff. Treat the following distinctions
as part of implementation, not a universal research gate before writing a spec.

## Public resources and manifests

`publicResourceFolders` and cross-app public `NavApp` resource access are candidates
from the supplied handoff; they were not located in the official pages consulted.
Before adopting them, inspect the installed AL18 manifest schema and target `NavApp`
declarations, retaining their actual method names, parameters and return types.
Check producer/consumer app identities and dependencies; compile both sides of a
minimal resource-consumption example in the approved scratch project. Do not infer
public availability from a file merely being packaged. Expose only the intended
resources. If unsupported, retain the project's existing resource approach and
record the limitation. No invented `NavApp` method is prescribed here.

## Query isolation

The requested candidate is `ReadState = ReadCommitted`. The BC29 overview announces
committed query reads, but the detailed
[ReadState reference](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/properties/devenv-readstate-property)
still lists `ReadUncommitted`, `ReadShared` and `ReadExclusive` at the check date.
Confirm `ReadCommitted` in the installed compiler/property schema before adding it.
Do not equate it with repeatable reads or assume it prevents every concurrent
change. Select isolation for the business invariant and test competing transactions;
compilation alone cannot establish locking behavior. Do not change existing query
isolation across the project as a blanket performance optimization.

## Isolated storage concurrency

The handoff calls for an isolation-aware `IsolatedStorage.Get` overload. The BC29
overview confirms isolation controls for storage reads, but exact overloads must
come from target declarations. Do not confuse `DataScope` (ownership scope) with
transaction isolation. For read-modify-write behavior, verify parameter order,
supported isolation values, locking lifetime and competing-session results.
Keep existing overloads where concurrency control is not required. Do not silently
introduce broad locking or a new transaction boundary.

## Test lifecycle instrumentation

`TestHandlers`, `ITestHandler` and default handlers are candidates for the announced
lifecycle extension. Inspect actual target interfaces/properties before coding;
do not substitute legacy `[HandlerFunctions]` examples as proof of those declarations.
Add instrumentation only for a logging, measurement, setup or cleanup requirement.
Prefer scoped handlers; default/global registration has wider effects and needs
an explicit requirement. It does not replace the runner, UI handlers, assertions,
test isolation or RED → GREEN evidence. Verify a handler actually runs using the
approved runner, retaining per-test pass/fail/skip results and raw output.

## Namespace-aware translations

`TranslationsWithNamespaces` is the candidate flag named by the handoff for the
announced namespace-aware identifiers. Confirm its spelling and placement in the
installed manifest schema before enabling it. Generate XLF in a controlled copy
and compare IDs for namespaced objects, same-name objects in distinct namespaces
and existing non-namespaced objects. Preserve translated targets and identify any
remapping required. Do not regenerate all identifiers or discard translations on
the assumption that compatibility is automatic.

## AL0926 section order

BC29's overview explicitly identifies AL0926 as a clearer diagnostic for misplaced
AL object sections. Read the actual compiler message and object type; move the
offending section into the required position and rebuild. Do not derive a universal
ordering for all object types from the code alone. This is an implementation
correction, not an orchestration failure. If AL0926 did not occur, do not fabricate
its text or claim the project was tested against it.

## Dependency compatibility

Compare dependency app ID/name/publisher, declared minimum version, resolved package,
runtime and required APIs. Library versions need not equal the extension's own
version. Keep compatibility questions in existing spec assumptions/Open Questions,
with an owner and the affected build/test validation. Continue drafting what can
be specified; never turn a skipped or unavailable test into a successful run.

## Evidence boundary

Documented: the capability announcements above. Declared: candidate spellings from
the user handoff and prepared research contract. Pending local validation: installed
schema/declaration support, compilation and runtime behavior for each feature used.
Save actual observations in the existing project artifacts, not a new registry.
