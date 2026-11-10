<frontmatter>
  title: Project notes
  pageNav: 3
  pageNavTitle: "Project"
</frontmatter>

# Project notes

## Product direction

CS3227-2610-MP4 is a team software-engineering project for a programming and software-development context. It explores role-based task work, GitHub commit evidence, and carefully bounded AI assistance.

The project brief calls for a production-minded, secured web application, separated development and production environments, and evidence of context engineering and resource-aware use. The product website is a separate static site published through GitHub Pages; it is independent of the application deployment.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/` | Next.js application and server-side modules |
| `docs/` | Developer and user documentation |
| `openspec/` | Requirements, designs, and implementation tasks |
| `workflow/` | Agent roles, handoffs, and workflow records |
| `logs/` | Reviewed summaries of AI-assisted development sessions |
| `product-website/` | MarkBind source for this product-information site |

## Team

This is a team submission. Individual names and responsibilities are maintained in project records rather than inferred or repeated here.

## Deployment

The site is configured for the repository path `/CS3227-2610-MP4/`. Its workflow builds on pull requests for review and deploys only after a push to `master`. A repository maintainer must select GitHub Actions as the Pages publishing source before the first deployment can publish.
