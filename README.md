# Project studio

A page where Zain types a project idea. The local server creates a public repository under `zaintarq` and commits a small program that states the idea. A second box commits a later improvement onto a repository that already exists.

Run it from this folder:

```
node server.mjs
```

Then open http://127.0.0.1:8787 while `gh` is logged in as `zaintarq`.

The page on GitHub Pages cannot create repositories by itself, because that would need a token in the browser. This server uses the GitHub login already on the machine.
