# Tech Demo of AI message builder
I'm building a CRM and messaging application.  One of the functionalities I'm experimenting with using the CRM is having AI assisted messaging.  When you're doing an outreach campaign, we have 3 questions:

* Who?

* What?

* When?

We will come into this with one of the questions known, and I have access to the people database.  So say I'm running a political PAC against gun violence in New York City, and the customers are voters that we're soliciting for fundraising.  Additional consumer preference information, and anything else known about the people will be available as notes in the CRM.

The CRM supports scheduling sending a email and text messages, so when a message is desired, it can be added as a task and the system will process the task at the appropriate time.

I want this workflow:

* User creates an outreach campaign (Salesforce terminology).

* GUI prompt, which question do you have, basically radio buttons for who/what/when, and a text box for a description of what we want to talk about.

* I choose "What" and let's say I want to talk about preventing school shootings / violence as the subject matter.

* The user will be prompted if they have anything else, and to restrict it to certain people (e.g. only women, only Democrats, only people in NY-12) so we don't need to overprocess or send messages to irrelevant people.  The user will also be asked if we should try to target ALL of the people here even if the message is a poor fit (more on that below), and if we want to limit this to a single outreach message, a limit of some variant of messages, or have an individual message for each person.

Now for the technical part, the approach I came up with now is to:

* make a directory on the server.   Write an instructions.md in containing the prompt from the user, an explanation of the database context, and what we're trying to accomplish.
* Invoke an AI agent (Codex, Claude Code, OpenCode, etc) in automation mode and have it look through the database of people to try to find who we should send this message to.  At this point, this is as much an exercise in prompt engineering as it is a data exercise.  This can take a relatively long time.  Once an output file is created - basically a table of messages that we will send to users (what) and who the users are (who), the user will be prompted to review this.  We can then either manually schedule a send, or request the AI agent again to work out the when, which can vary by person (e.g. in a neighborhood with a lot of parents, and the people are aged 27-55, we might want to target this message to be around the time of school pickup so it's fresh on the recipient's mind)

# Technical build out
This will be a single user tech demo.

The demo will have two components - a Javascript web page that will use Sqlite3 Wasm or spl.js for local data storage and processing, and a server side component which will accept requests to run jobs in AI.
## User page
Should be a minimal web page in an htdocs directory.  The application should maintain a sqlite database in local storage so that we can open the application again later. We should put the steps a user can go through in a page, based on this:
0. Tools
* Clear all databases [ask if the user is sure]
* Delete all data [ask if user is sure, clears local storage, refresh the page]

1. Import Data
* There should be a way for a user to drag a .csv of information on and import it into the database.  When a CSV is found, the user should be prompted to map the rows to the tables.  Make sure there is a way of storing notes for each contact and account.  There should also be an option to only append the database, and only append notes.
* Offer a preview of the mapping

2. Select contacts.
* Should default to "SELECT * FROM CONTACTS". 
* Allow the user to enter an arbitrary Sql Query and see a table (anticipate 10000 or more results in some cases so needs to be scrollable)
* Ideally, we can build a filter search for the user by allowing clickable on "SELECT DISTINCT" for some columns with repeatable data (e.g. political party), but this can be built later.  Point being it's easy for a non technical user.

3. First Question
The user needs to have an idea for at least one question.
Radio button for "What?", "Who?", "When?", default to What.
Text area for prompt basis, default value of to "School Choice".

4. Additional Notes
Allow the user to add additional notes, and the following options:
* Use a single message for everyone 
OR
* Maximum number of different messages (selectable number)
OR
* Allow unique message for each recipient

Also, "Contact All Users including users that would be poorly targeted" (if this isn't checked, the AI can decide that this message is not a good fit for some users - e.g. talking about school choice to non-parents)

5. Prompt the AI
* Generate an instructions.md, and a sqlite database containing the users as filtered per Select  which the user can download. Or this can be pushed to the server side component.  There should also be a default command line file (which will allow us to test different AI setups - but put codex (assume it's in path on the server) and claude in non-interactive mode with a custom system prompt and a prompt telling it to do what's in insturctions.md and put the output results in another markdown file.

## Server
A simple minimal server should be written in golang and provide an HTTP REST API.  Note this will be used locally.  For sake of simplicity, no authentication.

It should be golang with sqlite.  It should be able to serve the files in an htdocs sub directory (which will contain the single page web application).

There should be a jobs queue (implement ourselves with a sqlite table), and a way of seeing the jobs.

There should be a way to add arbitrary jobs.  When a job is created, a subdirectory should be created with a name format jobYYYYMMDD-hhmmss (ISO 8601 time in UTC).  It should be possible to upload files in there, create a batch file / shell script for the command to run, and occasionally monitor the results.

The web page should be able to upload the sqlite extract and the instructions.md into a job, then start the job.

There should be a functionality to monitor the job process.

There should also be functionality to get the files in a jobs directory, and download the files individually over HTTP.

There should also be a way to kill a job (e.g. kills processes)

## Tying it together
The web app should poll for job completion every few seconds and offer job management options (e.g. cancel, download files).

If a job is completed, put a button to download the results, and we will want to have an AI conversation to refine it.

## Core theory
The AI should look through the database to find users based on their notes and demographic information.

It should write messages, and return a result of which messages to send, and come up with a strategy of when to best send the messages (e.g. talking about school choice around the time of school pickup may make sense since school is on their mind)

You can read @20260530-AI-Message-Prompt.md for some thoughts on the app.

Remember this is just a tech demo and will be refined later.  It will not be on the internet, and will be run locally

## Local database tables
Based on a simple CRM design, see the tables in @setup_draft.sql

