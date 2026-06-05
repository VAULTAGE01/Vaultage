# Project Scanning

Project scanning is a local-only workflow that helps map vault fields to a
project's expected environment keys.

## What It Does

- Reads user-selected local folders or files.
- Detects likely env keys and common env-file names.
- Records local project metadata and suggested mappings.
- Supports explicit `.env` export from selected saved vault fields.

## What It Does Not Do

- It does not upload project paths or file contents.
- It does not connect to remote services.
- It does not infer secrets from source code.
- It does not write `.env` files without an explicit user action.

## Safety Notes

Keep generated `.env` files out of version control. The export flow can add
the target file to `.gitignore`, but users should still review their project
state before committing.
