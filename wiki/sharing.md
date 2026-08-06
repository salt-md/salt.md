# Sharing

Salt.md is a private workspace by default. Nothing is reachable without signing
in until somebody deliberately shares it. There are two ways to let outsiders
in, and they do very different things.

## A public page

A read-only link to one page. Anyone who has the link can open it; nobody needs
an account.

```
set_sharing(page_id: "...", public: true)
set_sharing(page_id: "...", public: true, expires_in_days: 14)
set_sharing(page_id: "...", public: true, password: "…")
set_sharing(page_id: "...", public: false)     ← revokes it
```

- The link is served at `/public/<token>` as **standalone HTML** — no
  single-page app, no JavaScript. It loads on anything and it cannot leak the
  rest of your instance, because none of the rest is there.
- **Sharing again replaces the previous link.** The old one stops working. That
  is the way to rotate a link you sent to the wrong person.
- `expires_in_days` and `password` are optional and independent. A password
  prompt is a plain HTML form on the same page.
- Sub-pages are **not** included. Sharing a page shares that page.

An agent should only do this when a person asked for it. Minting a public link
is not a reading operation.

## Public forms

A **form view** on a collection ([Views](views.md)) can be published. Then a
stranger fills it in and a row appears in your collection.

This is the shape behind a contact form, a leave request, an incident report —
anything where the outside world creates structured data you then work with
normally.

- Only **fillable** property types appear on a form. There is nothing to type
  into a rollup, a formula or a backrelation, so they are not offered.
- Select and multiselect show their options; a submitted value that is not one
  of them is refused.
- The form writes a row and nothing else. It cannot read your data back.

Publishing and withdrawing a form is done from the view.

## Private pages

Inside a workspace, everything is readable by every member — **except** a page
marked private, which only its owner sees.

This is a flag on a page, not a permission system. There is no per-page access
list, no "share with these three people". If you need that, the answer is a
separate workspace.

A private page hides its subtree: pages under it are invisible too, and its
links and tags do not appear in other people's searches or graphs.

## The trash

Deleting a page moves it to the trash. It is not destroyed:

- A page in the trash can be restored, with its subtree.
- It disappears from listings, search, backlinks and the graph immediately.
- After **30 days** it is deleted for good. An admin can change that, or set it
  to 0 to disable automatic purging entirely
  ([Administration](administration.md)).

## What is never shared

- Sharing a page does not share the workspace it lives in.
- A public link carries no session and grants nothing else.
- An API token is not a share: it carries the full identity of the person who
  made it. See [Agents](agents.md#tokens-are-a-second-key-not-a-guest-pass).
