# Views

A **view** is a saved way of looking at one collection. A collection can have
several, and they are independent: changing a filter on the board does not touch
the table.

Seven types.

| Type | Shows | Needs |
| --- | --- | --- |
| `table` | rows and columns | nothing |
| `board` | cards in columns | a property to group by |
| `list` | one line per row, compact | nothing |
| `gallery` | cards with the cover image | nothing |
| `calendar` | rows placed on dates | a date property |
| `timeline` | bars across time | a start date, optionally an end date |
| `form` | a public form that creates rows | nothing |

## What every view has

- **Columns** — which properties are visible, and in which order.
- **Filters** — conditions a row must meet. See below.
- **Sort** — one property, ascending or descending.
- **Group by** — for boards, which property makes the columns.

## Filters

Seven operators. This is the complete list.

| Operator | Matches |
| --- | --- |
| `is` | equal to the value — or, for a list property, contains it |
| `is_not` | not equal — and an **empty value counts as "is not X"** |
| `is_empty` | no value: null, empty string, or an empty list |
| `is_not_empty` | any value |
| `contains` | substring, also inside a list |
| `gt` | greater than — numeric if both look numeric, else text |
| `lt` | less than, same rule |

Two behaviours worth stating plainly:

- **`is_not` includes empties.** A row with no status is "not done". That is
  usually what people mean and occasionally not.
- **`is` and `contains` look inside lists.** Filtering a multiselect or a
  relation for one value works without any special operator.

Omitting the operator means `is` when a value is given and `is_not_empty` when
it is not.

## Boards

A board groups by a **select** property by default — one column per option, plus
one for rows without a value.

- Drag a card between columns to set the property.
- The card's `⋯` opens it, moves it to another column, or throws it away. Touch
  devices cannot drag, which is why the move menu exists at all.
- Adding a card inside a column pre-fills the group property.

A board can also group by a **relation**, which is why relations are shown on
cards at all.

## Calendar and timeline

The calendar places rows on a **date** property. Its first weekday follows the
account's region setting, and the column headings agree with it — that agreement
is asserted by a test, because it is the kind of thing that goes wrong per
locale and nobody notices.

The timeline draws a bar from a start date to an end date. With no end date, it
draws a point.

## Form views

A form view turns a collection into something a stranger can fill in. See
[Sharing](sharing.md#public-forms) — this is where a form view becomes a URL.

Only fillable property types appear. Derived properties never do: there is
nothing to type into a rollup.

## Managing views

The view bar carries the current view's settings — filter, sort, group, columns,
Properties — plus a `⋯` with:

- **Rename view**
- **Move left / Move right** — the order is the order of the tabs
- **Remove view** — only when more than one exists

Over MCP the same is done with `set_view` (creating and updating are the same
call) and `delete_view`.
