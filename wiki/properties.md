# Properties

A **property** is a typed field on a collection's schema. There are thirteen
types. Ten store a value; three are **derived** — computed every time a row is
read and never written down.

Every property has an **id** and a **name**. People see the name. You write the
id.

```
get_collection(page_id: "<collection>")   → ids, names, types, options
set_properties(page_id: "<row>", properties: { "<id>": <value> })
```

## The one thing that goes wrong most often

**Values are written by id, not by label.** A select option shown as
"In Arbeit" may well have the id `in-arbeit`. Writing `"In Arbeit"` produces a
value that no filter matches and no board column shows — silently, because there
is nothing wrong with the string.

**A relation is always a list**, even with one target: `["<page-id>"]`, never
`"<page-id>"`.

Both are visible in `get_collection`. Call it before you write.

## Stored types

### text

A string. Long text is fine — the editor renders a multi-line field.

### number

A number. Used by rollups, formulas and numeric sorting.

### select

One value from a fixed set of **options**. Each option has an `id`, a `name` and
a colour. Boards group by a select by default: one column per option, plus one
for rows with no value.

### multiselect

Zero or more options from the same kind of set. Stored as a list.

### date

A **calendar date**, optionally with a time: `2026-07-18` or `2026-07-18T14:30`.

A date property is never converted between timezones. A deadline on the 18th is
the 18th in Auckland and in Los Angeles. This is deliberate and it is enforced
by tests — the alternative silently moves deadlines by a day for anybody west of
Greenwich.

### checkbox

True or false.

### checklist

A list of items, each with its own done flag. One property, many boxes — for the
case where a row has a small fixed set of steps and they do not deserve a
collection of their own.

### person

A member of the workspace, stored as an account id. Use the ids from
`get_workspace`, which lists every member with theirs.

Can hold several people; the interface stacks their avatars.

### url

A link. Rendered as one, and treated as a contact detail on board cards.

### relation

A pointer at rows in another collection — or in the same one.

**Always a list**, even for a single target:

```
set_properties(page_id: "<task>", properties: { "system": ["<system-row-id>"] })
```

Permission is checked **per target row**, not per collection. A relation cannot
reveal that a row exists in something you may not read.

## Derived types

These three are computed on read by the server, in this order: **backrelation,
then rollup, then formula.** The order is load-bearing — see below.

### backrelation

The reverse of a relation somebody else declared. It holds no data at all: it
asks *"which rows over there point at me?"* and answers at read time.

Configured with two fields: `backrelationCollection` (where to look) and
`backrelationProp` (which relation property over there points back here).

**Why it is not stored.** Keeping the reverse side as real data means keeping two
lists in step on every write from both directions — and the first missed update
leaves them disagreeing with no way to tell which one is right. This costs one
query plus a scan instead, and cannot be wrong.

A backrelation produces an id list shaped exactly like a relation's. That is why
it is computed first: **a rollup can then aggregate over it.** "How many of the
tasks pointing at this system are done" is only expressible because of that
ordering.

Permission is checked per row here too.

### rollup

Aggregates a property across the rows a relation (or backrelation) points at.

| Function | Result |
| --- | --- |
| `count` | how many related rows |
| `sum` | total of a number property |
| `avg` | mean of a number property |
| `min` | smallest |
| `max` | largest |

**A rollup may carry a condition**, which is what turns it from a count into a
progress figure:

| Field | Meaning |
| --- | --- |
| `rollupWhereProp` | which property of the related row to test |
| `rollupWhereOp` | `is`, `is_not`, `is_empty`, `is_not_empty`, `contains` |
| `rollupWhereValue` | a single value |
| `rollupWhereValues` | several values — for `is` and `is_not` |

Two details worth knowing:

- **No condition means every related row counts.** Rollups written before
  conditions existed keep their meaning exactly.
- **An unrecognised operator compares for equality** rather than matching
  everything. The convenient reading would turn a typo into "100 % done".
- **`rollupWhereValues` takes several values because one comparison cannot say
  "open".** Open is neither *done* nor *discarded*, and an `is_not` against
  "done" alone counts every discarded row as open — silently, and by exactly the
  amount nobody notices.

### formula

Arithmetic over the row's own properties. Be precise about the scope, because
the word invites bigger expectations:

**What it can do:** `+`, `-`, `*`, `/`, parentheses, numbers, unary minus, and a
reference to another property written `{propId}`. A formula may reference
another formula; circular references are detected and refused.

```
{done} / {total} * 100
({hours} - {billed}) * {rate}
```

**What it cannot do:** no functions, no text, no dates, no conditionals, no
references to other rows. If you need any of those, the answer is a rollup, or a
number a person or an agent writes.

Division by zero is an error rather than a silent zero.

## Property types on a board card

Board cards do not print a field list. Each property is sorted into a **zone** by
its type and sometimes by its value — a phone number becomes an icon, a sentence
becomes a note line. Two rules are worth knowing because they surprise people:

- **A backrelation is hidden on cards.** On a "system" row that would be every
  task pointing at it — fine in a table, far too much for a card.
- **The property a board groups by is dropped from its own cards**, so a card
  never repeats its column heading.

## Changing a schema

`update_schema` adds, changes and removes properties. Removing one removes its
values. Adding one leaves existing rows empty rather than filling a default —
an empty value and a default are different facts, and the difference matters
when you later filter on it.
