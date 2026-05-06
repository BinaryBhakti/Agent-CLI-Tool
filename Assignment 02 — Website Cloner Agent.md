# **Assignment 02 — AI Agent CLI Tool**

## **Problem Statement**

Build a **conversational CLI agent** — similar to how Cursor or Windsurf work — where the user can chat with the agent directly in the terminal.

The agent must be able to take a user's instruction and **clone the Scaler Academy website** by generating a fully working webpage using HTML, CSS, and JavaScript. The output must include:

* Header  
* Hero Section  
* Footer

The generated files must open in a browser and visually resemble the Scaler website.

## **What is Expected**

* A CLI tool that runs in the terminal and accepts natural language questions/instructions from the user  
* The agent reasons through the task, takes actions, and produces real output files  
* The final output is a working `.html` file (with CSS and JS) that looks like the Scaler website  
* The agent must loop — it should not complete everything in a single step

## **Submission**

Submit both of the following on the course portal:

1. **GitHub Repository Link** — must be public  
2. **YouTube Video Link** — 2 to 3 minutes, public or unlisted, showing the CLI agent running live and the final output opening in the browser

Submissions missing either will not be evaluated.

## **Marking Scheme — 10 Points**

| Criterion | Marks |
| :---: | :---: |
| GitHub Repository | 2 |
| YouTube Demo Video | 2 |
| Agent Loop & Reasoning | 2 |
| Quality of Cloned Website  | 2 |
| Code Quality & Documentation | 2 |

Code : 

import "dotenv/config";

import axios from "axios";

import "dotenv/config";

import { OpenAI } from "openai";

import { exec } from "child\_process";

import { error } from "console";

async function getTheWeatherOfCity(cityname \= "") {

   const url \= \`https://wttr.in/${cityname.toLowerCase()}?format=%C+%t\`;

   const { data } \= await axios.get(url, { responseType: "text" });

   return \`The Weather of ${cityname} is ${data}\`;

}

async function getGithubDetailsAboutUser(username \= "") {

   const url \= \`https://api.github.com/users/${username}\`;

   const {data} \= await axios.get(url);


   return {

       login : data.login ,

       name : data.name,

       blog : data.blog,

       public\_repos : data.public\_repos

   }

}

async function  executeCommand(cmd \= "") {

   return new Promise((res , rej) \=\> {

       exec(cmd , (error , data) \=\> {

           if(error){

               return error;

           }

           else {

               res(cmd);

           }

       })

   })

}

// getGithubDetailsAboutUser("tanishq4141").then(data \=\> console.log(data));

const client \= new OpenAI();

const tool\_map \= {

   getTheWeatherOfCity : getTheWeatherOfCity,

   getGithubDetailsAboutUser : getGithubDetailsAboutUser,

   executeCommand : executeCommand

}

async function main(params) {

   const system\_prompt \=

       \`

       You are an AI Assistant who works on INPUT , THINK, TOOL, OBSERVE and OUTPUT format.

       You will be responsible to break down the major problem into smaller problem.

       You will be doing multiple thinking steps before providing any output.

       You will be having access of some tools that you can use.

       Tools :

       1\. getTheWeatherOfCity(cityname : string) : This tool fetches the live weather of the city.

       2\. getGithubDetailsAboutUser(username : string) : This tool gives the public github info about user.

       3\. executeCommand(cmd : string) : This tool executes lunix / unix command inside the machine of user.

       Rules :

       1\. You will always follow the JSON format

       2\. You will be doing one step at a time and wait for previous step to be completed

       3\. You will always do multiple thinking steps before producing any output.

       4\. After every TOOL step wait of the OBSERVE step.

      

       Output format :

       { "step" : "START | THINK | TOOL | OBSERVE | OUTPUT" , "content" : "string" , "tool\_name" : "string" , "tool\_args" : "string" }

       Examples :

       user : What is the weather of Delhi ?

       assistant : { "step" : "START" , "content" : "User want me to get the current weather of Delhi "}

       assistant : { "step" : "THINK" , "content" : "Let me check I have any tool for fetching live weather of city "}

       assistant : { "step" : "THINK" , "content" : "Great , I found one tool named getTheWeatherOfCity which fetches the live weather data of city"}

       assistant : { "step" : "TOOL" , "tool\_name" : "getTheWeatherOfCity" , "tool\_args" : "Delhi" }

       developer : { "step" : "OBSERVE" , "content" : "The Weather of Delhi is Partly cloudy \+33°C" }

       assistant : { "step" : "THINK" , "content" : "Great I got the weather of Delhi which is Partly cloudy \+33°C"}

       assistant : { "step" : "OUTPUT" , "content" : "Weather of Delhi is Partly cloudy \+33°C Please carry umbrealla with you "}

   \`

   const message \= \[

       {

           role: "system",

           content: system\_prompt

       },

       {

           role: "user",

           content: 'Create a folder named todo\_app and create a simple todo application using HTML,CSS and JS inside that folder'

       },

   \]

   while (true) {

       const respone \= await client.chat.completions.create({

           model: 'gpt-4.1-mini',

           messages: message

       });

       const content \= respone.choices\[0\].message.content;

       const parsedContent \= JSON.parse(content);

       message.push({

           role: 'assistant',

           content: JSON.stringify(parsedContent)

       })

       if (parsedContent.step \=== "START") {

           console.log("STARTING STEP .... \\n");

           console.log(parsedContent)

       }

       else if (parsedContent.step \=== "THINK") {

           console.log("THINKING ..... \\n")

           console.log(parsedContent)

       }

       else if (parsedContent.step \=== "TOOL") {

           console.log("TOOL calling .... \\n");

           console.log(\`calling ${parsedContent.tool\_name}\`)

           if(\!tool\_map\[parsedContent.tool\_name\]){

               message.push({

                   role : "developer",

                   content : JSON.stringify({

                       "step" : "OBSERVE",

                       "content" : "This tool is not avalibale"

                   })

               })

           }

           else{

               // tool call

               const data \= await tool\_map\[parsedContent.tool\_name\](parsedContent.tool\_args);

                message.push({

                   role : "developer",

                   content : JSON.stringify({

                       "step" : "OBSERVE",

                       "content" : data

                   })

               })

           }

       }

       else if (parsedContent.step \=== "OUTPUT") {

           console.log("OUTPUT");

           console.log(parsedContent)

           break;

       }

   }

   // stateless

}

main();

