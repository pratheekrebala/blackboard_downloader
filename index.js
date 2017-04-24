const Xray = require('x-ray');
const request = require('request-promise-native');
const request_native = require('request');
const FileCookieStore = require('tough-cookie-filestore');
const parseXML = require('xml2js').parseString;
const inquirer = require('inquirer');
const prompt = inquirer.createPromptModule();
const url = require('url');
const fs = require('fs-extra');
const path = require('path');
const queue = require('queue');

const download_root = './Downloads'

const q = queue({
    concurrency: 1,
    autostart: true
});

var blackboard_url = 'https://blackboard.gwu.edu/';

var x = Xray({
    filters: {
        trim: function (value) {
            return typeof value === 'string' ? value.trim() : value
        }
    }
});

const login_schema = [
    {
        type: 'input',
        name: 'name',
        message: 'Blackboard Username',
        required: true
    },
    {
        type: 'password',
        name: 'password',
        message: 'Blackboard Password',
        required: true
    }
]

var options = {
    jar: request.jar(new FileCookieStore('cookies.json')),
    baseUrl: blackboard_url,
    followAllRedirects: true
}

function getCredentials(){
    return new Promise((resolve, reject) => {
        prompt(login_schema).then((result) => {
            console.log(`Logging in using username: ${result.name}`);
            resolve(result);
        });
    })
}

function login(creds) {
    return new Promise((resolve, reject) => {
        options.uri = 'webapps/login/';
        options.formData = {
            'user_id': creds.name,
            'password': creds.password
        }
        request.post(options).then(body => {
            return checkLogin();
        });
    })
}

function checkLogin() {
    return new Promise((resolve, reject) => {
        options.uri = ''
        request.get(options).then(body => {
            let not_logged_in = body.includes("Forgot");
            if (not_logged_in) {
                console.log('Not Logged in.');
                resolve(false)
            }
            else {
                console.log('Logged in');
                resolve(true)
            }
        })
    })
}

function getCourses() {
    options.uri = 'webapps/portal/execute/tabs/tabAction';
    options.formData = {
        action:'refreshAjaxModule',
        modId:'_388_1',
        tabId:'_498_1',
        tab_tab_group_id:'_26_1'
    }
    return new Promise((resolve, reject) => {
        request.post(options).then(body => {
            //Response is an XML with content inside the contents tag.
            parseXML(body, function (err, result) {
                page_body = result['contents'];
                x(page_body, '.courseListing > li', [{
                courseName: 'a',
                courseInstructor: '.courseInformation > .name',
                courseLink: 'a@href'
                }])((err, obj) => {
                    if(!err) return resolve(obj);
                    else reject(err);
                })
            });
        })
    })
}

function getCourse(course){
    let course_url = url.parse(course['courseLink'], parseQueryString = true);
    let course_id = course_url.query.id;
    getCourseStructure(course_id);
}

function getCourseStructure(course_id){
    let course_structure_url = `webapps/blackboard/execute/course/menuFolderViewGenerator`
    options.uri = course_structure_url;
    options.formData = null;
    options.form = {
        expandAll: 'true',
        storeScope:'Session',
        course_id: course_id,
        displayMode:'courseMenu_newWindow',
        editMode:'false',
        openInParentWindow:'true'
    }
    options.json = false;
    request.post(options).then(results => {
        parseTree(JSON.parse(results));
    })
    //pipe(fs.createWriteStream('list.json'))
}

function parseTreeChild(treeChild, path){
    if(treeChild.hasChildren) {
        if(treeChild.id.includes('ReferredToType:CONTENT') || !treeChild.id){
            parseContents(treeChild);
             treeChild.children.forEach((child) => {
                parseTreeChild(child, path);
            })
                //fetchPage(result);
        }
    }
}

function parseHref(content){
    return new Promise((resolve, reject) => {
        x(content, {
                    title: 'a | trim',
                    link: 'a@href'
        })((err, result) => {
            if(!err) resolve(result);
            else reject(err);
        })
    })
}

let pages_to_fetch =  [];

function parseContents(treeChild, parent){
    return new Promise((resolve, reject) => {
        if(treeChild.id.includes('ReferredToType:CONTENT') || !treeChild.id || treeChild.type == 'ROOT'){
            parseHref(treeChild.contents).then(result => {
                result.title = result.title || '';
                result.path = parent && parent.path != '' ? parent.path + '/' + result.title : result.title;
                if(treeChild.hasChildren) {
                    if(result.hasOwnProperty('link')) pages_to_fetch.push(result);
                    Promise.all(treeChild.children.map(child => {
                        return parseContents(child, result);
                    })).then(() => {
                        resolve(pages_to_fetch);
                    })
                }
                else resolve(pages_to_fetch);
            })
        }
        else resolve(pages_to_fetch)
    });
}

function fetchPage(page){
    return new Promise((resolve, reject) => {
        options.uri = page.link;
        options.form = {}
        request(options).then((body) => {
            x(body, '#content_listContainer > li', [{
                name: '.item.clearfix | trim',
                attachments: x('ul.attachments.clearfix > li', [{
                    name: 'a | trim',
                    link: 'a@href'
                }])
            }])((err, result) => {
                page.results = result
                resolve(page);
            })
        })
    })
}

function constructFilePath(attachment, result, page){
    let file_path = `${download_root}/${page.path}/${result.name}/${attachment.name}`
    return file_path;
}

function downloadFiles(page){
    let results = page.results;
    //Download all files in a given page.
    results.forEach(result => {
        result.attachments.forEach(attachment => {
            shouldDownload(attachment, result, page).then(should_download => {
                if(should_download) {
                    q.push(function(cb) {
                        dl_options = options;
                        dl_options.uri = attachment.link;
                        dl_options.resolveWithFullResponse = true;
                        let file_path = constructFilePath(attachment, result, page);
                        fs.mkdirs(path.dirname(file_path), err => {
                            if(!err) {
                                console.log(file_path);
                                request_native(options).pipe(fs.createWriteStream(file_path)).on('finish', () => {
                                    console.log('finished');
                                    console.log('Waiting for 3 seconds.')
                                    setTimeout(cb, 1000)
                                });
                            }
                        })
                    });
                }
            })
        })
    })
}

function shouldDownload(attachment, attachment_parent, page){
    return new Promise((resolve, reject) => {
        let file_path = constructFilePath(attachment, attachment_parent, page);
        if (fs.existsSync(file_path)) {
            console.log(`${file_path} already exists.`);
            resolve(false);
        }
        else resolve(true);
    })
}

function parseTree(structure_tree){
    let tree_root = structure_tree['children'][0]
    parseContents(tree_root).then((pages_to_fetch) => {
        Promise.all(pages_to_fetch.map(page => {
            return fetchPage(page)
        })).then((results) => {
            results.forEach((result) => {
                console.log(result);
                //downloadFiles(result);
            })
        })
    });
}

checkLogin().then(loggedIn => {
    if(!loggedIn) getCredentials().then(login).then(loggedIn => {
        if (!loggedIn) console.log('Login Failed.')
        else console.log('Login Success.');
    })
    else console.log('Already Loggedin');
    if(loggedIn) startFetch();
})


function startFetch(){
    getCourses().then((result) => {
        let courses = result;
        let course_choices = result.map((course, i) => {return {name: `(${course.courseInstructor}): ${course.courseName}`, value: i}});
        let course_prompt = {
            type: 'list',
            name: 'courseChoice',
            message: 'Select a course to download.',
            choices: course_choices
        };
        prompt(course_prompt).then((result) => {
            let selected_course = courses[result.courseChoice];
            getCourse(selected_course)
        });
    });
}