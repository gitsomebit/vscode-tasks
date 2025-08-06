const vscode = require('vscode');
const os = require('os');

var activePanels = new Map(); // Track active panels: key = panelKey, value = panel
var statusBarArray = [];
var selectList = [];
var eventChangeActiveTextEditor;
var outputChannel;
const RunTaskCommand = "actboy168.run-task"
const SelectTaskCommand = "actboy168.select-task"
const ShowGroupTasksCommand = "actboy168.show-group-tasks"
const ShowAllTasksCommand = "actboy168.show-all-tasks"

//const VSCodeVersion = (function() {
//    const res = vscode.version.split(".");
//    return parseInt(res[1]);
//})()

function LOG(msg) {
    if (outputChannel === undefined) {
        outputChannel = vscode.window.createOutputChannel("Extension-Tasks");
    }
    outputChannel.appendLine(msg);
}

function needShowStatusBar(statusBar, currentFilePath) {
    try {
        return !statusBar.filePattern || (currentFilePath && new RegExp(statusBar.filePattern).test(currentFilePath));
    } catch (error) {
        LOG(`Error validating status bar item '${statusBar.text}' filePattern for active file '${currentFilePath}'. ${error.name}: ${error.message}`);
    }
    return false;
}

function updateStatusBar() {
    for (const statusBar of statusBarArray) {
        statusBar.hide();
    }
    selectList = [];

    const settings = vscode.workspace.getConfiguration("tasks.statusbar");
    let count = 0;
    const currentFilePath = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName;
    for (let i = 0; i < statusBarArray.length - 1; ++i) {
        const statusBar = statusBarArray[i];
        if (needShowStatusBar(statusBar, currentFilePath)) {
            if (typeof settings.limit === "number" && settings.limit <= count) {
                selectList.push({
                    label: statusBar.text,
                    description: statusBar.tooltip ? statusBar.tooltip.value : undefined,
                    task: statusBar.isGroup ? statusBar.groupTasks : statusBar.command.arguments[0]
                });
            }
            else {
                statusBar.show();
                count++;
            }
        }
    }

    if (selectList.length > 0) {
        statusBarArray[statusBarArray.length - 1].show();
    }
}

function openUpdateStatusBar() {
    if (eventChangeActiveTextEditor === undefined) {
        eventChangeActiveTextEditor = vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
    }
    updateStatusBar();
}

function closeUpdateStatusBar() {
    if (eventChangeActiveTextEditor !== undefined) {
        eventChangeActiveTextEditor.dispose();
        eventChangeActiveTextEditor = undefined;
    }
}

function cleanStatusBar() {
    statusBarArray.forEach(i => {
        i.hide();
        i.dispose();
    });
    statusBarArray = [];
}

function deactivate() {
    closeUpdateStatusBar();
    cleanStatusBar();

    // Clean up all active panels
    for (const [panelKey, panel] of activePanels) {
        try {
            if (panel && !panel.disposed) {
                panel.dispose();
            }
        } catch (error) {
            LOG(`Error disposing panel ${panelKey}: ${error.message}`);
        }
    }
    activePanels.clear();

    if (outputChannel !== undefined) {
        outputChannel.dispose();
    }
}

const platform = os.platform();

function getPlatformValue(t) {
    if (platform == "win32") {
        return t.windows
    }
    else if (platform == "darwin") {
        return t.osx
    }
    else {
        return t.linux
    }
}

function deepClone(a, b) {
    if (typeof b !== "object" || !b) {
        return b;
    }
    if (Array.isArray(b)) {
        return b.slice();
    }
    let o = typeof a === "object" ? a : {};
    for (const k in b) {
        o[k] = deepClone(o[k], b[k]);
    }
    return o;
};

function copyObject(t, a) {
    for (const k in a) {
        t[k] = deepClone(t[k], a[k])
    }
}

function copyObjectWithIgnore(t, a, ignore) {
    for (const k in a) {
        if (!(k in ignore)) {
            t[k] = deepClone(t[k], a[k])
        }
    }
}

const ignore_globals = {
    tasks: true,
    version: true,
    windows: true,
    osx: true,
    linux: true,
};

const ignore_locals = {
    windows: true,
    osx: true,
    linux: true,
};

function computeTaskInfo(task, config) {
    let t = {}
    copyObjectWithIgnore(t, config, ignore_globals)
    copyObject(t, getPlatformValue(config))
    copyObjectWithIgnore(t, task, ignore_locals)
    copyObject(t, getPlatformValue(task))
    if (t.type === undefined) {
        t.type = "process";
    }
    return t
}

const ObjectAttribute = {
    label: "name",
    detail: "detail",
};

const VSCodeAttribute = {
    label: true,
    icon: true,
    detail: true,
    hide: true,
};

const HasDefaultAttribute = {
    hide: true,
    color: true,
};

function isObject(obj) {
    var type = typeof obj;
    return type === 'object' && !!obj;
}

function getAttribute(taskObject, taskInfo, key, isRunning) {
    if (isObject(taskInfo.options) && isObject(taskInfo.options.statusbar)) {
        if (isRunning && isObject(taskInfo.options.statusbar.running)) {
            if (key in taskInfo.options.statusbar.running) {
                return taskInfo.options.statusbar.running[key];
            }
        }
        if (key in taskInfo.options.statusbar) {
            return taskInfo.options.statusbar[key];
        }
    }
    if (taskObject !== undefined && key in ObjectAttribute) {
        const objectKey = ObjectAttribute[key];
        if (objectKey in taskObject) {
            return taskObject[objectKey];
        }
    }
    if (key in VSCodeAttribute) {
        if (key in taskInfo) {
            return taskInfo[key];
        }
    }
    if (key in HasDefaultAttribute) {
        const settings = vscode.workspace.getConfiguration("tasks.statusbar.default");
        if (settings === undefined) {
            return;
        }
        return settings[key];
    }
}

function getTaskGroup(taskInfo) {
    if (isObject(taskInfo.options) && isObject(taskInfo.options.statusbar)) {
        return taskInfo.options.statusbar.group;
    }
    return undefined;
}

function parseGroupHierarchy(groupString) {
    if (!groupString || typeof groupString !== 'string') {
        return null;
    }

    // Split by forward slash and clean up each part
    const parts = groupString.split('/').map(part => part.trim()).filter(part => part.length > 0);

    if (parts.length === 0) {
        return null;
    }

    return {
        fullPath: groupString,
        parts: parts,
        depth: parts.length,
        parentPath: parts.length > 1 ? parts.slice(0, -1).join('/') : null,
        leafName: parts[parts.length - 1]
    };
}

function getGroupDisplayName(groupString) {
    const hierarchy = parseGroupHierarchy(groupString);
    return hierarchy ? hierarchy.leafName : groupString;
}

function getGroupFullPath(groupString) {
    const hierarchy = parseGroupHierarchy(groupString);
    return hierarchy ? hierarchy.fullPath : groupString;
}

function computeTaskExecutionId(taskInfo, type) {
    const props = [];
    const command = taskInfo.command;
    const args = taskInfo.args;
    props.push(type);
    if (typeof command === "string") {
        props.push(command);
    }
    else if (Array.isArray(command)) {
        let cmds;
        for (const c of command) {
            if (typeof c === "string") {
                if (cmds === undefined) {
                    cmds = c;
                }
                else {
                    cmds += ' ' + c;
                }
            }
        }
        if (cmds !== undefined) {
            props.push(cmds);
        }
    }
    else {
        return;
    }
    if (Array.isArray(args) && args.length > 0) {
        for (const arg of args) {
            if (typeof arg == "string") {
                props.push(arg);
            } else if (typeof arg == "object") {
                props.push(arg.value);
            }
        }
    }
    let id = '';
    for (let i = 0; i < props.length; i++) {
        id += props[i].replace(/,/g, ',,') + ',';
    }
    return id;
}

function computeTaskExecutionDefinition(taskInfo, type) {
    const id = computeTaskExecutionId(taskInfo, type);
    if (id === undefined) {
        return {
            type: "$empty"
        };
    }
    return {
        type: id !== undefined ? type : "$empty",
        id: id
    };
}

function computeTaskDefinition(taskInfo) {
    const type = taskInfo.type;
    if (type == "shell" || type == "process") {
        return computeTaskExecutionDefinition(taskInfo, type);
    }
    return taskInfo;
}

function deepEqual(a, b) {
    const a_type = typeof a;
    const b_type = typeof b;
    if (a_type !== b_type) {
        return false;
    }
    if (a_type !== "object") {
        return a === b;
    }
    const a_keys = Object.keys(a);
    const b_keys = Object.keys(b);
    if (a_keys.length !== b_keys.length) {
        return false;
    }
    for (const key of a_keys) {
        if (!deepEqual(a[key], b[key])) {
            return false;
        }
    }
    return true;
}

function matchComposite(a, b) {
    if (a.definition.type == "npm") {
        // TODO: check detail
        if (b.label === undefined) {
            return a.name === b.script;
        }
        else {
            return a.name === b.label;
        }
    }
    if (a.detail !== b.detail) {
        return false;
    }
    return a.name === b.label;
}

function matchDefinition(a, b) {
    for (const k in a) {
        const v = a[k];
        if (!deepEqual(v, b[k])) {
            return false;
        }
    }
    return true;
}

function matchTask(tasks, taskInfo) {
    const taskDefinition = computeTaskDefinition(taskInfo);
    for (let i = 0; i < tasks.length; ++i) {
        const v = tasks[i];
        if (matchComposite(v, taskInfo)) {
            if (v.definition.type === "$empty"
                || v.definition.type === "$composite"
                || matchDefinition(v.definition, taskDefinition)
            ) {
                tasks.splice(i, 1);
                return v;
            }
        }
    }
}

function convertColor(color) {
    if (typeof color == "string") {
        if (color.slice(0, 1) === "#") {
            return color;
        }
        else if (color === "") {
            return undefined;
        }
        else {
            return new vscode.ThemeColor(color);
        }
    }
    return undefined;
}

function convertTooltip(tooltip) {
    if (tooltip) {
        let md = new vscode.MarkdownString(tooltip);
        md.isTrusted = true;
        md.supportThemeIcons = true;
        return md;
    }
}

function createMasterTasksStatusBar() {
    return {
        text: "Tasks",
        tooltip: convertTooltip("Show all tasks organized by groups"),
        color: undefined,
        backgroundColor: undefined,
        filePattern: undefined,
        command: ShowAllTasksCommand,
        isMaster: true
    };
}
function createSelectStatusBar() {
    const settings = vscode.workspace.getConfiguration("tasks.statusbar.select");
    return {
        text: settings.label || "...",
        tooltip: undefined,
        color: convertColor(settings.color),
        backgroundColor: undefined,
        filePattern: undefined,
        command: SelectTaskCommand
    };
}

function buildGroupTree(memoryStatusBarArray) {
    const groupedTasks = [];
    const ungroupedTasks = [];

    // Separate grouped and ungrouped tasks
    for (const statusBarItem of memoryStatusBarArray) {
        if (statusBarItem.group) {
            groupedTasks.push(statusBarItem);
        } else {
            ungroupedTasks.push(statusBarItem);
        }
    }

    if (groupedTasks.length === 0) {
        return ungroupedTasks;
    }

    // Build tree structure
    const tree = new Map();

    // First pass: collect all tasks by their root groups
    for (const task of groupedTasks) {
        const hierarchy = parseGroupHierarchy(task.group);
        if (hierarchy) {
            const rootGroup = hierarchy.parts[0];
            if (!tree.has(rootGroup)) {
                tree.set(rootGroup, {
                    name: rootGroup,
                    tasks: [],
                    subgroups: new Map()
                });
            }
            tree.get(rootGroup).tasks.push(task);
        }
    }

    // Build the hierarchical tree for each root group
    for (const [rootName, rootGroup] of tree) {
        buildSubgroupTree(rootGroup, rootGroup.tasks);
    }

    const result = [];

    // Add ungrouped tasks first
    result.push(...ungroupedTasks);

    // Process each root group
    for (const [rootName, rootGroup] of tree) {
        // Check if group has only one task
        if (rootGroup.tasks.length === 1) {
            // Show the individual task instead of a group button
            const singleTask = rootGroup.tasks[0];
            result.push({
                text: singleTask.text,
                tooltip: singleTask.tooltip,
                color: singleTask.color,
                backgroundColor: singleTask.backgroundColor,
                filePattern: singleTask.filePattern,
                isGroup: false, // Mark as individual task
                command: singleTask.command // Use the task's command directly
            });
        } else {
            // Create a group button for multiple tasks
            result.push({
                text: rootName,
                tooltip: convertTooltip(`Group: ${rootName} (${rootGroup.tasks.length} tasks)`),
                color: rootGroup.tasks[0]?.color,
                backgroundColor: rootGroup.tasks[0]?.backgroundColor,
                filePattern: rootGroup.tasks[0]?.filePattern,
                isGroup: true,
                isHierarchical: true,
                groupPath: rootName,
                groupTree: rootGroup,
                groupTasks: rootGroup.tasks,
                command: {
                    command: ShowGroupTasksCommand,
                    arguments: [rootGroup.tasks, rootGroup]
                }
            });
        }
    }

    return result;
}

function buildSubgroupTree(parentGroup, tasks) {
    // Group tasks by their next level path segment relative to parent
    const subgroupMap = new Map();
    const directTasks = [];

    for (const task of tasks) {
        const hierarchy = parseGroupHierarchy(task.group);
        if (hierarchy && hierarchy.parts.length > 1) {
            // Find the current depth based on parent group name
            const parentDepth = parentGroup.name.split('/').length;
            if (hierarchy.parts.length > parentDepth) {
                // Has deeper subgroups
                const nextLevel = hierarchy.parts[parentDepth];
                if (!subgroupMap.has(nextLevel)) {
                    subgroupMap.set(nextLevel, []);
                }
                subgroupMap.get(nextLevel).push(task);
            }
        } else {
            // Direct task at this level
            directTasks.push(task);
        }
    }

    // Build subgroup tree recursively
    for (const [subgroupName, subgroupTasks] of subgroupMap) {
        const fullSubgroupPath = parentGroup.name === subgroupName ? subgroupName : `${parentGroup.name}/${subgroupName}`;
        const subgroup = {
            name: fullSubgroupPath,
            tasks: subgroupTasks,
            subgroups: new Map()
        };

        parentGroup.subgroups.set(subgroupName, subgroup);

        // Recursively build deeper levels
        buildSubgroupTree(subgroup, subgroupTasks);
    }
}
function groupTasks(memoryStatusBarArray) {
    // Use the new hierarchical tree building approach
    LOG(`groupTasks: Processing ${memoryStatusBarArray.length} tasks`);
    const result = buildGroupTree(memoryStatusBarArray);
    LOG(`groupTasks: Returning ${result.length} items`);
    return result;
}

function syncStatusBar(memoryStatusBarArray) {
    const diff = memoryStatusBarArray.length - statusBarArray.length;
    for (let i = 0; i < diff; ++i) {
        let statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        statusBar.name = "Tasks";
        statusBarArray.push(statusBar);
    }
    for (let i = 0; i < -diff; ++i) {
        let statusBar = statusBarArray.pop();
        statusBar.hide();
        statusBar.dispose();
    }
    for (let i = 0; i < memoryStatusBarArray.length; ++i) {
        let to = statusBarArray[i];
        const from = memoryStatusBarArray[i];
        to.text = from.text;
        to.tooltip = from.tooltip;
        to.color = from.color;
        to.backgroundColor = from.backgroundColor;
        to.filePattern = from.filePattern;
        to.command = from.command;
        to.isGroup = from.isGroup || false; // Default to false if not specified
        to.groupTasks = from.groupTasks;
        to.isMaster = from.isMaster || false; // Default to false if not specified
    }
}

function matchTasksInScope(memoryStatusBarArray, tasks, runningTasks, config) {
    if (typeof config != "object" || !Array.isArray(config.tasks)) {
        return;
    }
    for (const taskCfg of config.tasks) {
        const taskInfo = computeTaskInfo(taskCfg, config);
        const hide = getAttribute(undefined, taskInfo, "hide");
        if (hide) {
            continue;
        }
        const taskObject = matchTask(tasks, taskInfo);
        if (!taskObject) {
            let label = getAttribute(undefined, taskInfo, "label");
            if (label !== undefined) {
                LOG(`Not found task: ${label}`);
            }
            else {
                LOG(`Not found task: { type:${taskCfg.type} }`);
            }
            continue;
        }
        const isRunning = runningTasks[taskObject._id];
        let label = getAttribute(taskObject, taskInfo, "label", isRunning);
        const icon = getAttribute(taskObject, taskInfo, "icon", isRunning);
        if (icon && icon.id) {
            label = `$(${icon.id}) ${label}`;
        }
        const detail = getAttribute(taskObject, taskInfo, "detail");
        const color = getAttribute(taskObject, taskInfo, "color", isRunning);
        const backgroundColor = getAttribute(taskObject, taskInfo, "backgroundColor", isRunning);
        const filePattern = getAttribute(taskObject, taskInfo, "filePattern");
        const group = getTaskGroup(taskInfo);

        memoryStatusBarArray.push({
            text: label,
            tooltip: convertTooltip(detail),
            color: convertColor(color),
            backgroundColor: backgroundColor ? new vscode.ThemeColor(backgroundColor) : undefined,
            filePattern: filePattern,
            group: group,
            command: {
                command: RunTaskCommand,
                arguments: [taskObject]
            }
        })
    }
}

function matchAllTasks(tasks) {
    let runningTasks = {};
    for (const e of vscode.tasks.taskExecutions) {
        runningTasks[e.task._id] = true;
    }
    // todo: use task.scope to filter
    let memoryStatusBarArray = [];
    const configuration = vscode.workspace.getConfiguration();
    if (configuration) {
        const tasksJson = configuration.inspect('tasks');
        if (tasksJson) {
            matchTasksInScope(memoryStatusBarArray, tasks, runningTasks, tasksJson.globalValue);
            matchTasksInScope(memoryStatusBarArray, tasks, runningTasks, tasksJson.workspaceValue);
        }
    }
    if (vscode.workspace.workspaceFile !== undefined) {
        for (const workspaceFolder of vscode.workspace.workspaceFolders) {
            const configuration = vscode.workspace.getConfiguration(null, workspaceFolder.uri);
            if (configuration) {
                const tasksJson = configuration.inspect('tasks');
                if (tasksJson) {
                    matchTasksInScope(memoryStatusBarArray, tasks, runningTasks, tasksJson.workspaceFolderValue);
                }
            }
        }
    }
    for (const task of tasks) {
        LOG(`No match task: ${task.name}`);
    }
    return memoryStatusBarArray;
}

function loadTasks() {
    if (vscode.workspace.workspaceFolders === undefined) {
        cleanStatusBar();
        closeUpdateStatusBar();
        return;
    }

    vscode.tasks.fetchTasks().then((tasks) => {
        tasks = tasks.filter(task => task.source === "Workspace");
        let memoryStatusBarArray = matchAllTasks(tasks);
        if (memoryStatusBarArray.length > 0) {
            // Apply grouping logic
            memoryStatusBarArray = groupTasks(memoryStatusBarArray);
            // Add master tasks button at the beginning (leftmost position)
            memoryStatusBarArray.unshift(createMasterTasksStatusBar());
            memoryStatusBarArray.push(createSelectStatusBar());
            syncStatusBar(memoryStatusBarArray);
            openUpdateStatusBar();
        }
        else {
            cleanStatusBar();
            closeUpdateStatusBar();
        }
    });
}

const MinimumFetchInterval = 1000;
var fetchLastTime = 0;
var fetchTimer;

function loadTasksDelay(timeout) {
    if (fetchTimer !== undefined) {
        clearTimeout(fetchTimer);
    }
    fetchTimer = setTimeout(() => {
        fetchTimer = undefined;
        fetchLastTime = Date.now();
        loadTasks();
    }, timeout);
}

function loadTasksWait() {
    const now = Date.now();
    if (now < fetchLastTime + MinimumFetchInterval) {
        loadTasksDelay(MinimumFetchInterval);
    } else {
        if (fetchTimer === undefined) {
            fetchLastTime = now;
            loadTasks();
        }
    }
}

function refreshTask(task) {
    if (task.source !== "Workspace") {
        return;
    }
    let memoryStatusBarArray = matchAllTasks([task]);
    if (memoryStatusBarArray.length == 0) {
        return;
    }
    let found = statusBarArray.find((statusBar) => {
        if (!statusBar.command.arguments) {
            return false;
        }
        if (statusBar.isGroup) {
            // Check if task is in group
            return statusBar.groupTasks && statusBar.groupTasks.some(groupTask =>
                groupTask.command.arguments[0]._id === task._id
            );
        }
        return statusBar.command.arguments[0]._id === task._id;
    });
    if (found) {
        const statusBar = memoryStatusBarArray[0];
        if (found.isGroup && found.groupTasks) {
            // Update task within group
            const taskInGroup = found.groupTasks.find(groupTask =>
                groupTask.command.arguments[0]._id === task._id
            );
            if (taskInGroup) {
                taskInGroup.text = statusBar.text;
                taskInGroup.tooltip = statusBar.tooltip;
                taskInGroup.color = statusBar.color;
                taskInGroup.backgroundColor = statusBar.backgroundColor;
            }
        } else {
            found.text = statusBar.text;
            found.tooltip = statusBar.tooltip;
            found.color = statusBar.color;
            found.backgroundColor = statusBar.backgroundColor;
        }
    }
}

function runTask(task) {
    vscode.tasks.executeTask(task).catch((err) => {
        vscode.window.showWarningMessage(err.message).then(_ => undefined);
    });
}

function showAllTasks() {
    // Fetch all tasks to build the complete tree
    vscode.tasks.fetchTasks().then((allTasks) => {
        const workspaceTasks = allTasks.filter(task => task.source === "Workspace");
        const allTaskItems = matchAllTasks(workspaceTasks);

        // Build complete hierarchical tree
        const masterTree = buildMasterTaskTree(allTaskItems);

        // Show in webview panel
        showMasterTasksPanel(masterTree);
    });
}

function buildMasterTaskTree(allTaskItems) {
    const tree = {
        name: "All Tasks",
        groups: new Map(),
        ungroupedTasks: []
    };

    // Separate grouped and ungrouped tasks
    for (const task of allTaskItems) {
        if (task.group) {
            const hierarchy = parseGroupHierarchy(task.group);
            if (hierarchy) {
                addTaskToTree(tree, hierarchy, task);
            }
        } else {
            tree.ungroupedTasks.push(task);
        }
    }

    return tree;
}

function addTaskToTree(tree, hierarchy, task) {
    let currentLevel = tree.groups;
    let currentPath = "";

    // Navigate/create the tree structure
    for (let i = 0; i < hierarchy.parts.length; i++) {
        const part = hierarchy.parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!currentLevel.has(part)) {
            currentLevel.set(part, {
                name: part,
                fullPath: currentPath,
                tasks: [],
                subgroups: new Map()
            });
        }

        const group = currentLevel.get(part);

        // If this is the final level, add the task
        if (i === hierarchy.parts.length - 1) {
            group.tasks.push(task);
        }

        // Move to next level
        currentLevel = group.subgroups;
    }
}

// Helper Functions for Panel Management
function createOrFocusPanel(panelKey, title, createPanelFn) {
    if (activePanels.has(panelKey)) {
        const existingPanel = activePanels.get(panelKey);
        if (existingPanel && !existingPanel.disposed) {
            existingPanel.reveal(vscode.ViewColumn.Active, false);
            LOG(`Focusing existing panel: ${title}`);
            return null; // Return null to indicate panel already exists
        } else {
            activePanels.delete(panelKey);
        }
    }

    // Create new panel
    const panel = createPanelFn();
    activePanels.set(panelKey, panel);

    // Set up common disposal handling
    panel.onDidDispose(() => {
        activePanels.delete(panelKey);
    });

    return panel;
}

function createWebviewPanel(id, title, options = {}) {
    const defaultOptions = {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
    };

    return vscode.window.createWebviewPanel(
        id,
        title,
        {
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: false
        },
        { ...defaultOptions, ...options }
    );
}

function setupPanelMessageHandling(panel, panelKey, messageHandlers) {
    panel.webview.onDidReceiveMessage(message => {
        if (message.command === 'close') {
            activePanels.delete(panelKey);
            panel.dispose();
            return;
        }

        const handler = messageHandlers[message.command];
        if (handler) {
            handler(message);
        }
    });
}

function autoFocusPanel(panel, timeout = 100) {
    setTimeout(() => {
        if (panel.visible) {
            panel.reveal(vscode.ViewColumn.Active, true);
        }
    }, timeout);
}

function generateTaskButton(task, index, indentLevel = 0) {
    const label = task.text.replace(/\$\([^)]+\)\s*/, '');
    const tooltip = task.tooltip ? task.tooltip.value || '' : '';
    const indent = indentLevel * 20;

    return `
        <button class="task-button" onclick="executeTask(${index})"
                title="${tooltip}" style="margin-left: ${indent}px;">
            <span class="task-icon">•</span>
            <span class="task-label">${label}</span>
        </button>
    `;
}

function generateGroupButton(groupName, groupPath, taskCount, level = 0) {
    const indent = level * 20;
    const groupId = `group-${groupPath.replace(/[^a-zA-Z0-9]/g, '-')}-${level}`;

    return `
        <div class="group-container" style="margin-left: ${indent}px;">
            <button class="group-header" onclick="toggleGroup('${groupId}')"
                    title="${groupPath}">
                <span class="expand-icon" id="icon-${groupId}">▶</span>
                <span class="group-name">${groupName}/</span>
                <span class="task-count">(${taskCount})</span>
            </button>
            <div class="group-content" id="content-${groupId}" style="display: none;">
    `;
}


function getCommonJavaScript(dataArray, dataVariableName = 'allTasks') {
    return `
        const vscode = acquireVsCodeApi();
        const ${dataVariableName} = ${JSON.stringify(dataArray)};

        function executeTask(index) {
            if (index >= 0 && index < ${dataVariableName}.length) {
                vscode.postMessage({
                    command: 'executeTask',
                    taskIndex: index
                });
            }
        }

        function toggleGroup(id) {
            const content = document.getElementById('content-' + id);
            const icon = document.getElementById('icon-' + id);

            if (content && icon) {
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    icon.classList.add('expanded');
                } else {
                    content.style.display = 'none';
                    icon.classList.remove('expanded');
                }
            }
        }

        window.addEventListener('load', () => {
            document.body.focus();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                vscode.postMessage({ command: 'close' });
            }
        });
    `;
}

function showMasterTasksPanel(masterTree) {
    const panelKey = 'masterTasksPanel';

    const panel = createOrFocusPanel(panelKey, 'All Tasks', () =>
        createWebviewPanel('masterTasksPanel', 'All Tasks')
    );

    if (!panel) return; // Panel already exists and was focused

    // Collect all tasks for execution mapping
    const allTasks = [];
    function collectAllTasks(groups) {
        for (const [groupName, group] of groups) {
            allTasks.push(...group.tasks);
            collectAllTasks(group.subgroups);
        }
    }
    collectAllTasks(masterTree.groups);
    allTasks.push(...masterTree.ungroupedTasks);

    // Generate tree HTML
    function generateMasterTreeHTML(groups, level = 0) {
        let html = '';

        for (const [groupName, group] of groups) {
            const hasSubgroups = group.subgroups.size > 0;
            const hasDirectTasks = group.tasks.length > 0;

            if (hasSubgroups || hasDirectTasks) {
                const taskCount = group.tasks.length + countNestedTasks(group.subgroups);
                html += generateGroupButton(groupName, group.fullPath, taskCount, level);

                // Recursive subgroups
                html += generateMasterTreeHTML(group.subgroups, level + 1);

                // Direct tasks in this group
                for (const task of group.tasks) {
                    const taskIndex = allTasks.indexOf(task);
                    html += generateTaskButton(task, taskIndex, level + 1);
                }

                html += '</div></div>';
            }
        }

        return html;
    }

    function countNestedTasks(groups) {
        let count = 0;
        for (const [_, group] of groups) {
            count += group.tasks.length;
            count += countNestedTasks(group.subgroups);
        }
        return count;
    }

    // Generate ungrouped tasks HTML
    let ungroupedHTML = '';
    if (masterTree.ungroupedTasks.length > 0) {
        ungroupedHTML = '<div class="ungrouped-section"><div class="section-header">Ungrouped Tasks:</div>';
        for (const task of masterTree.ungroupedTasks) {
            const taskIndex = allTasks.indexOf(task);
            ungroupedHTML += generateTaskButton(task, taskIndex);
        }
        ungroupedHTML += '</div>';
    }

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${panelCSS}
        </head>
        <body>
            <div class="header">All Tasks</div>
            ${generateMasterTreeHTML(masterTree.groups)}
            ${ungroupedHTML}

            <script>
                ${getCommonJavaScript(allTasks)}

                // Auto-expand first level on load
                window.addEventListener('load', () => {
                    const firstLevelGroups = document.querySelectorAll('[id^="content-group-"][id$="-0"]');
                    firstLevelGroups.forEach(group => {
                        const id = group.id.replace('content-', '');
                        toggleGroup(id);
                    });
                });
            </script>
        </body>
        </html>
    `;

    setupPanelMessageHandling(panel, panelKey, {
        executeTask: (message) => {
            const taskIndex = message.taskIndex;
            if (taskIndex >= 0 && taskIndex < allTasks.length) {
                const task = allTasks[taskIndex].command.arguments[0];
                runTask(task);
            }
        }
    });

    autoFocusPanel(panel);
}

function showSelectTasks(items) {
    const panelKey = 'taskSelectDropdown';

    const panel = createOrFocusPanel(panelKey, 'Select Tasks', () =>
        createWebviewPanel('taskSelectDropdown', 'Select Tasks')
    );

    if (!panel) return;

    // Generate HTML for all tasks including groups
    const taskButtons = items.map((item, index) => {
        const label = item.text.replace(/\$\([^)]+\)\s*/, '');
        const tooltip = item.tooltip ? item.tooltip.value || '' : '';
        const isGroup = item.isGroup;

        return `
            <button class="task-button ${isGroup ? 'group-button' : ''}"
                    onclick="${isGroup ? `showGroup(${index})` : `executeTask(${index})`}"
                    title="${tooltip}">
                <span class="task-label">${label}${isGroup ? ' ▼' : ''}</span>
                ${tooltip ? `<span class="task-description">${tooltip}</span>` : ''}
            </button>
        `;
    }).join('');

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${panelCSS}
        </head>
        <body>
            <div class="header">Select task to execute:</div>
            ${taskButtons}
            <script>
                ${getCommonJavaScript(items)}

                function showGroup(index) {
                    vscode.postMessage({
                        command: 'showGroup',
                        groupIndex: index
                    });
                }
            </script>
        </body>
        </html>
    `;

    setupPanelMessageHandling(panel, panelKey, {
        executeTask: (message) => {
            const taskIndex = message.taskIndex;
            if (taskIndex >= 0 && taskIndex < items.length && !items[taskIndex].isGroup) {
                const task = items[taskIndex].command.arguments[0];
                runTask(task);
            }
        },
        showGroup: (message) => {
            const groupIndex = message.groupIndex;
            if (groupIndex >= 0 && groupIndex < items.length && items[groupIndex].isGroup) {
                if (items[groupIndex].groupTasks.length === 1) {
                    const task = items[groupIndex].groupTasks[0].command.arguments[0];
                    runTask(task);
                    activePanels.delete(panelKey);
                    panel.dispose();
                } else {
                    activePanels.delete(panelKey);
                    panel.dispose();
                    const groupName = items[groupIndex].text;
                    showGroupTasks(items[groupIndex].groupTasks, groupName);
                }
            }
        }
    });

    autoFocusPanel(panel);
}

function showHierarchicalGroupTasks(groupTree) {
    const panelKey = `hierarchicalTaskGroup-${groupTree.name.replace(/[^a-zA-Z0-9]/g, '-')}`;

    const panel = createOrFocusPanel(panelKey, groupTree.name, () =>
        createWebviewPanel('hierarchicalTaskGroup', groupTree.name)
    );

    if (!panel) return;

    // Generate HTML for hierarchical view
    function generateTreeHTML(group, level = 0) {
        let html = '';

				// Add subgroups
				for (const [subgroupName, subgroup] of group.subgroups) {
						html += `
								<div class="subgroup" style="margin-left: ${level * 20}px;">
										<button class="subgroup-header" onclick="toggleSubgroup('${subgroupName}-${level}')"
														title="Expand/Collapse ${subgroupName}">
												<span class="expand-icon" id="icon-${subgroupName}-${level}">▶</span>
												<span class="subgroup-name">${subgroupName}/</span>
										</button>
										<div class="subgroup-content" id="content-${subgroupName}-${level}" style="display: none;">
												${generateTreeHTML(subgroup, level + 1)}
										</div>
								</div>
						`;
				}

        // Add direct tasks at this level
        const directTasks = group.tasks.filter(task => {
            const hierarchy = parseGroupHierarchy(task.group);
            return hierarchy && hierarchy.parts.length === level + 1;
        });

        for (const task of directTasks) {
            const taskIndex = group.tasks.indexOf(task);
            html += generateTaskButton(task, taskIndex, level);
        }


        return html;
    }

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${panelCSS}
        </head>
        <body>
            <div class="header">${groupTree.name}:</div>
            ${generateTreeHTML(groupTree)}

            <script>
                ${getCommonJavaScript(groupTree.tasks, 'groupTasks')}

                function toggleSubgroup(id) {
                    const content = document.getElementById('content-' + id);
                    const icon = document.getElementById('icon-' + id);

                    if (content.style.display === 'none') {
                        content.style.display = 'block';
                        icon.classList.add('expanded');
                    } else {
                        content.style.display = 'none';
                        icon.classList.remove('expanded');
                    }
                }
            </script>
        </body>
        </html>
    `;

    setupPanelMessageHandling(panel, panelKey, {
        executeTask: (message) => {
            const taskIndex = message.taskIndex;
            if (taskIndex >= 0 && taskIndex < groupTree.tasks.length) {
                const task = groupTree.tasks[taskIndex].command.arguments[0];
                runTask(task);
            }
        }
    });

    autoFocusPanel(panel);
}

function showGroupTasks(groupTasks, groupName = 'Tasks') {

    // const panelKey = `taskGroupDropdown-${groupName}`;
    const panelKey = `taskGroupDropdown-${groupName.replace(/[^a-zA-Z0-9]/g, '-')}`;

    const panel = createOrFocusPanel(panelKey, groupName, () =>
        createWebviewPanel('taskGroupDropdown', groupName)
    );

    if (!panel) return;

    // Generate HTML for the dropdown
    const taskButtons = groupTasks.map((task, index) => {
        const label = task.text.replace(/\$\([^)]+\)\s*/, '');
        const tooltip = task.tooltip ? task.tooltip.value || '' : '';
        return `
            <button class="task-button" onclick="executeTask(${index})" title="${tooltip}">
                <span class="task-label">${label}</span>
                ${tooltip ? `<span class="task-description">${tooltip}</span>` : ''}
            </button>
        `;
    }).join('');

    panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${panelCSS}
        </head>
        <body>
            <div class="header">Select task to execute:</div>
            ${taskButtons}
            <script>${getCommonJavaScript(groupTasks, 'groupTasks')}</script>
        </body>
        </html>
    `;

    setupPanelMessageHandling(panel, panelKey, {
        executeTask: (message) => {
            const taskIndex = message.taskIndex;
            if (taskIndex >= 0 && taskIndex < groupTasks.length) {
                const task = groupTasks[taskIndex].command.arguments[0];
                runTask(task);
            }
        }
    });

    autoFocusPanel(panel);
}

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand(RunTaskCommand, (args) => {
            switch (typeof args) {
                case "number":
                    const statusBar = statusBarArray[args - 1];
                    if (statusBar) {
                        const task = statusBar.command.arguments[0];
                        runTask(task);
                    }
                    else {
                        LOG(`Not found task #${args}`);
                    }
                    break;
                case "object":
                    runTask(args);
                    break;
                default:
                    LOG(`Invalid task: ${args}`);
                    break;
            }
        }),
        vscode.commands.registerCommand(ShowAllTasksCommand, () => {
            showAllTasks();
        }),
        vscode.commands.registerCommand(SelectTaskCommand, () => {
            if (selectList.some(item => Array.isArray(item.task))) {
                // If there are grouped tasks in select list, show them in webview too
                const webviewItems = selectList.map(item => {
                    if (Array.isArray(item.task)) {
                        // Check if group has only one task
                        if (item.task.length === 1) {
                            // Convert single-task group to regular task item
                            return {
                                text: item.label,
                                tooltip: { value: item.description },
                                command: { arguments: [item.task[0]] },
                                isGroup: false
                            };
                        } else {
                            return {
                                text: item.label,
                                tooltip: { value: item.description },
                                command: { arguments: [null] },
                                isGroup: true,
                                groupTasks: item.task
                            };
                        }
                    } else {
                        return {
                            text: item.label,
                            tooltip: { value: item.description },
                            command: { arguments: [item.task] }
                        };
                    }
                });
                showSelectTasks(webviewItems);
            } else {
                vscode.window.showQuickPick(selectList, { placeHolder: "Select task to execute" }).then(value => {
                    if (value !== undefined) {
                        runTask(value.task);
                    }
                });
            }
        }),

        vscode.commands.registerCommand(ShowGroupTasksCommand, (groupTasks, groupTree = null) => {
            // Check if group has only one task - if so, execute it directly
            if (groupTasks.length === 1) {
                LOG(`Single task in group, executing directly: ${groupTasks[0].text}`);
                runTask(groupTasks[0].command.arguments[0]);
                return;
            }

            // Extract group name from the first task in the group
            let groupName = 'Tasks';
            if (groupTasks.length > 0 && groupTasks[0].group) {
                const groupPath = groupTasks[0].group;
                groupName = getGroupDisplayName(groupPath);
            }

            // If we have a tree structure, show hierarchical view
            if (groupTree) {
                showHierarchicalGroupTasks(groupTree);
            } else {
                showGroupTasks(groupTasks, groupName);
            }
        }),

        vscode.workspace.onDidChangeConfiguration(loadTasksWait),
        vscode.workspace.onDidChangeWorkspaceFolders(loadTasksWait),
        vscode.tasks.onDidStartTask((e) => {
            refreshTask(e.execution.task);
        }),
        vscode.tasks.onDidEndTask((e) => {
            refreshTask(e.execution.task);
        })
    );
    loadTasksDelay(0);
}

exports.activate = activate;
exports.deactivate = deactivate;

const panelCSS = `
  <style>
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--vscode-sideBar-background);
      color: var(--vscode-foreground);
      min-width: 350px;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
    }
    .header {
      padding: 8px 12px 12px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 12px;
      font-size: 1.1em;
      font-weight: 600;
      color: var(--vscode-panelTitle-activeForeground);
    }
    .group-header,
    .task-button {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 6px 8px;
      margin: 1px 0;
      background: transparent;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      text-align: left;
      border-radius: 3px;
      transition: background 0.1s;
    }
    .group-header:hover,
    .task-button:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .task-button:active {
      background: var(--vscode-list-activeSelectionBackground);
    }
    .expand-icon {
      display: inline-block;
      width: 16px;
      margin-right: 4px;
      transition: transform 0.2s;
      font-size: 12px;
    }
    .expand-icon.expanded {
      transform: rotate(90deg);
    }
    .group-name {
      color: var(--vscode-symbolIcon-folderForeground);
      flex-grow: 1;
    }
    .task-count {
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
      margin-left: 8px;
    }
    .task-icon {
    //   display: inline-block;
      width: 16px;
      margin-right: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
    }
    .task-label {
      flex-grow: 1;
    }
    .group-content {
      overflow: hidden;
    }
    .section-header {
      font-weight: 500;
      color: var(--vscode-panelTitle-activeForeground);
      margin: 12px 0 6px 0;
      padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .ungrouped-section {
      margin-top: 16px;
    }
    .subgroup-header {
        display: block;
        width: calc(100% - 20px);
        padding: 4px 12px;
        margin: 2px 0;
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        text-align: left;
        border-radius: 2px;
        font-weight: 500;
    }
    .subgroup-header:hover {
        background: var(--vscode-list-hoverBackground);
    }
    .subgroup-name {
        color: var(--vscode-symbolIcon-folderForeground);
    }
    .subgroup-content {
        overflow: hidden;
        transition: all 0.2s ease;
    }

</style>
`;
