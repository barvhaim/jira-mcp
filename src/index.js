#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import JiraClient from 'jira-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// Validate required environment variables
const requiredEnvVars = ['JIRA_HOST', 'JIRA_USERNAME', 'JIRA_ACCESS_TOKEN'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Create JIRA client instance
const jiraClient = new JiraClient({
  host: process.env.JIRA_HOST,
  username: process.env.JIRA_USERNAME,
  password: process.env.JIRA_ACCESS_TOKEN,
  protocol: 'https',
  apiVersion: '2',
  strictSSL: true
});

// Define MCP tools
const GET_PROJECTS_TOOL = {
  name: "getProjects",
  description: "Get list of JIRA projects",
  inputSchema: {
    type: "object",
    properties: {
      archived: {
        type: "boolean",
        description: "Include archived projects"
      }
    }
  }
};

const GET_TASKS_TOOL = {
  name: "getTasks",
  description: "Get JIRA tasks based on JQL query",
  inputSchema: {
    type: "object",
    properties: {
      jql: {
        type: "string",
        description: "JQL query to filter tasks"
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Fields to include in the response"
      }
    },
    required: ["jql"]
  }
};

const GET_TASK_TOOL = {
  name: "getTask",
  description: "Get a single JIRA task by ID",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      }
    },
    required: ["taskId"]
  }
};

const UPDATE_TASK_STATUS_TOOL = {
  name: "updateTaskStatus",
  description: "Update the status of a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      statusId: {
        type: "string",
        description: "ID of the target status"
      }
    },
    required: ["taskId", "statusId"]
  }
};

const UPDATE_TASK_OWNER_TOOL = {
  name: "updateTaskOwner",
  description: "Update the assignee of a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      },
      accountId: {
        type: "string",
        description: "Account ID of the user to assign the task to"
      }
    },
    required: ["taskId", "accountId"]
  }
};

const GET_TASK_ATTACHMENTS_TOOL = {
  name: "getTaskAttachments",
  description: "Get list of attachments for a JIRA task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      }
    },
    required: ["taskId"]
  }
};

const GET_AVAILABLE_STATUSES_TOOL = {
  name: "getAvailableStatuses",
  description: "Get list of available JIRA statuses for a task",
  inputSchema: {
    type: "object",
    properties: {
      taskId: {
        type: "string",
        description: "JIRA task ID (e.g., PROJECT-123)"
      }
    },
    required: ["taskId"]
  }
};

const server = new Server(
  {
    name: "jira-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    GET_PROJECTS_TOOL,
    GET_TASKS_TOOL,
    GET_TASK_TOOL,
    UPDATE_TASK_STATUS_TOOL,
    UPDATE_TASK_OWNER_TOOL,
    GET_AVAILABLE_STATUSES_TOOL,
    GET_TASK_ATTACHMENTS_TOOL
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "getProjects":
        const { archived = false } = request.params.arguments;
        const projects = await jiraClient.listProjects();
        const filteredProjects = archived ? 
          projects : 
          projects.filter(project => !project.archived);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(filteredProjects.map(project => ({
              id: project.id,
              key: project.key,
              name: project.name,
              archived: project.archived || false,
              projectTypeKey: project.projectTypeKey,
              simplified: project.simplified,
              style: project.style
            })), null, 2)
          }]
        };

      case "getTasks":
        const { jql, fields = ['summary', 'description', 'status', 'assignee', 'created', 'updated', 'duedate'] } = request.params.arguments;
        const tasks = await jiraClient.searchJira(jql, { fields });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(tasks.issues.map(issue => ({
              id: issue.id,
              key: issue.key,
              summary: issue.fields.summary,
              description: issue.fields.description,
              status: issue.fields.status,
              assignee: issue.fields.assignee,
              created: issue.fields.created,
              updated: issue.fields.updated,
              duedate: issue.fields.duedate,
              priority: issue.fields.priority
            })), null, 2)
          }]
        };

      case "getTask":
        const { taskId } = request.params.arguments;
        const issue = await jiraClient.findIssue(taskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: issue.id,
              key: issue.key,
              summary: issue.fields.summary,
              description: issue.fields.description,
              status: issue.fields.status,
              assignee: issue.fields.assignee,
              created: issue.fields.created,
              updated: issue.fields.updated,
              duedate: issue.fields.duedate,
              priority: issue.fields.priority
            }, null, 2)
          }]
        };

      case "updateTaskStatus":
        const task = request.params.arguments;
        const transitions = await jiraClient.listTransitions(task.taskId);
        const transition = transitions.transitions.find(t => t.to.id === task.statusId);
        
        if (!transition) {
          return {
            content: [{
              type: "text",
              text: `Invalid status transition for issue ${task.taskId} to status ${task.statusId}`
            }],
            isError: true
          };
        }

        await jiraClient.transitionIssue(task.taskId, { transition: { id: transition.id } });
        const updatedIssue = await jiraClient.findIssue(task.taskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: updatedIssue.id,
              key: updatedIssue.key,
              status: updatedIssue.fields.status
            }, null, 2)
          }]
        };

      case "updateTaskOwner":
        const { taskId: issueId, accountId } = request.params.arguments;
        await jiraClient.updateAssignee(issueId, accountId);
        const updatedTask = await jiraClient.findIssue(issueId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              id: updatedTask.id,
              key: updatedTask.key,
              assignee: updatedTask.fields.assignee
            }, null, 2)
          }]
        };

      case "getAvailableStatuses":
        const { taskId: statusTaskId } = request.params.arguments;
        const availableTransitions = await jiraClient.listTransitions(statusTaskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(availableTransitions.transitions.map(transition => ({
              id: transition.id,
              name: transition.name,
              to: {
                id: transition.to.id,
                name: transition.to.name,
                statusCategory: transition.to.statusCategory
              }
            })), null, 2)
          }]
        };

      case "getTaskAttachments":
        const { taskId: attachmentTaskId } = request.params.arguments;
        const taskWithAttachments = await jiraClient.findIssue(attachmentTaskId);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(taskWithAttachments.fields.attachment?.map(attachment => ({
              id: attachment.id,
              filename: attachment.filename,
              created: attachment.created,
              size: attachment.size,
              mimeType: attachment.mimeType,
              content: attachment.content,
              thumbnail: attachment.thumbnail
            })) || [], null, 2)
          }]
        };

      default:
        return {
          content: [{
            type: "text",
            text: `Unknown tool: ${request.params.name}`
          }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: error.message
      }],
      isError: true
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("JIRA MCP server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
