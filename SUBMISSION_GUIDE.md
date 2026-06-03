# Submission Guide

## What to submit

Submit these three items together:

1. Final Word report file
2. GitHub repository URL for this simulator project
3. Vercel deployment URL for the running simulator

## GitHub upload checklist

1. Create a new repository, for example `spin-coating-ebp-simulator`.
2. Upload all files in this folder to the repository root.
3. Confirm that `package.json`, `index.html`, `vite.config.js`, and the `src/` folder are visible in the repository.
4. Copy the GitHub repository URL.

## Vercel deployment checklist

1. Import the GitHub repository into Vercel.
2. Select the Vite framework preset.
3. Use build command `npm run build`.
4. Use output directory `dist`.
5. Deploy and copy the generated Vercel URL.

## Quick local test before upload

```bash
npm install
npm run dev
```

Check that the following tabs work:

- Core interactive
- Validation
- Design exploration

Then test the production build:

```bash
npm run build
npm run preview
```

## Final LMS submission text

Use the text in `submission_comment.txt` after replacing the placeholders with your actual GitHub and Vercel links.
