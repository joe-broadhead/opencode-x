---
name: x-write
description: Load before any X change - bookmarking or unbookmarking a post, creating a bookmark folder, drafting or publishing a long-form X Article - or when the user asks to post, reply, quote, repost, like, follow, message or delete on X.
---
# Changing things on X

## The one rule

Make a change only when the user asked for it. Before the call, write one sentence in your reply on what it does and
whom it reaches, then make the one call in the same turn. The permission prompt is the user's yes.

Ask in chat first only when something must be chosen: which post, which folder, which draft, which account. After a
decline, say that nothing changed and offer the draft or a retry. Never work around a decline with another tool, a
link or a screenshot.

## Whom each change reaches

- `create_users_bookmark`: only the user. Private, reversible, no notification. Say the post's author and opening
  words before the call. "This bookmarks @author's post '…' for you only."
- `delete_users_bookmark`: only the user. It removes a saved item, not a post. "This removes your bookmark on
  @author's post '…'; the post stays."
- `create_users_bookmark_folder`: only the user, visible in their X app. "This creates the bookmark folder '…' for
  you only."
- `article_create_draft`: only the user. Nothing is public yet. Say the title, and keep the returned draft id for
  publishing. "This saves a private Article draft titled '…'."
- `article_publish`: public. It appears on the user's profile and in followers' timelines, and this plugin has no
  tool to unpublish it. Show the title and the opening lines first, then say: "This publishes '…' publicly on your
  profile; the only way to remove it is to delete the post in the X app."

Each call is billed to the user's credits: about $0.005 for a bookmark change, and a post create for publishing.

## Drafting an Article

`article_create_draft` takes a title and a body. The live schema decides whether the body is plain text, markdown or
X's DraftJS blocks, and whether cover media is a media id: read the signature before composing. Write the body from
what the user gave you, not from fetched posts unless they asked. Say the draft is private, and give its id.

Publishing happens in two steps: draft, then `article_publish` with the draft's id. Never publish a draft the user
has not seen. Never retry a publish: a timeout may still have published it, so say so and check the profile.

## Not available: posting, replying, quoting, reposting, liking, following, DMs, deleting posts, lists

X's MCP exposes none of them. Say so plainly, and don't route around it with another plugin, a web fetch or a
scraper. Offer what is possible: draft the text in chat so the user can post it, or publish it as an Article if it is
long-form.

If X ever lists one of these, it is public and asks every time: show the exact text, name the account, and keep to
X's rules. AI-generated replies need X's prior approval, replies are allowed only when the author summoned the
replier, and likes must be the user's own action, never automated or bulk.

## Never bulk

No loop over posts to bookmark, like or reply. No "engage with everyone who mentioned me". One user request, one
call. A folder of ten bookmarks is ten asks: say so before you start, and ask whether to continue.

## Publishing other people's words

An Article that quotes or summarises posts is the user's writing about them. Keep quotes short and attributed, and
never republish a post's full text as the user's own. Personal data rules from the x skill still apply.

## If a change is refused

A change may ask, and a denied one never runs. If publishing is off in this agent, say it is off and that the user
can narrow or allow it in that agent's own `permissions`; don't edit their configuration. Never answer "Always
allow" for publishing: that saves an allow for every agent in the project.
