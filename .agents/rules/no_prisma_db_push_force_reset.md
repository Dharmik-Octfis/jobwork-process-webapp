# Restricted Command

## NEVER RUN `npx prisma db push --force-reset`

Under absolutely no circumstances should the agent run the command `npx prisma db push --force-reset`. 
This command is strictly prohibited as it performs a destructive force-reset on the database. 
If a database schema change is needed, follow the established migration flow. Never force reset.
