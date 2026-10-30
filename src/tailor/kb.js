// Knowledge base for resume tailoring (no AI, plain rules).
// Every skill has aliases as a regex. `have` marks skills that are really on the master resume.
// Skills the candidate does NOT have are listed too, so a post asking for them lowers the fit score
// and shows up as a "gap" instead of being claimed.

// [id, display name, group, regex, have, related skill ids that a post implies]
const S = (id, name, group, re, have = false, implies = []) => ({ id, name, group, re, have, implies });

export const SKILLS = [
  // ---- Frontend (have) ----
  S('react', 'React.js', 'Frontend', /\breact(?:\.?js)?\b(?!\s*native)(?!\s+(?:to|on|and respond|quickly|fast|accordingly|appropriately|swiftly))/i, true, ['javascript', 'html', 'css']),
  S('nextjs', 'Next.js', 'Frontend', /\bnext\.js\b|\bnextjs\b|\bnext\s+js\b/i, true, ['react']),
  S('angular', 'AngularJS', 'Frontend', /\bangular(?:\.?js)?\b/i, true, ['typescript', 'javascript']),
  S('redux', 'Redux', 'Frontend', /\bredux\b|\brtk\b|redux[- ]toolkit|\bzustand\b|\bmobx\b/i, true, ['react']),
  S('javascript', 'JavaScript', 'Frontend', /\bjavascript\b|\bes6\b|\becmascript\b|\bjs\b(?!on)/i, true),
  S('typescript', 'TypeScript', 'Frontend', /\btypescript\b|\bts\b(?=[\s,/)])/i, true, ['javascript']),
  S('html', 'HTML', 'Frontend', /\bhtml5?\b/i, true),
  S('css', 'CSS', 'Frontend', /\bcss3?\b|\bsass\b|\bscss\b/i, true),
  S('tailwind', 'Tailwind CSS', 'Frontend', /tailwind/i, true, ['css']),
  S('graphql', 'GraphQL', 'Frontend', /graph\s?ql|\bapollo\b/i, true),
  S('gsap', 'GSAP', 'Frontend', /\bgsap\b|greensock/i, true),
  S('framer', 'Framer Motion', 'Frontend', /framer[- ]motion/i, true),
  S('responsive', 'Responsive Design', 'Frontend', /responsive|cross[- ]browser|mobile[- ]first/i, true, ['html', 'css']),

  // ---- Frontend (not on the resume) ----
  S('vue', 'Vue.js', 'Frontend', /\bvue(?:\.?js)?\b|\bnuxt\b|\bvuex\b|\bpinia\b/i),
  S('svelte', 'Svelte', 'Frontend', /\bsvelte(?:kit)?\b/i),
  S('jquery', 'jQuery', 'Frontend', /\bjquery\b/i),
  S('bootstrap', 'Bootstrap', 'Frontend', /\bbootstrap\b/i),
  S('webpack', 'Webpack', 'Frontend', /\bwebpack\b|\brollup\b/i),
  S('vite', 'Vite', 'Frontend', /\bvite\b/i, true),
  S('storybook', 'Storybook', 'Frontend', /storybook/i),

  // ---- UI libraries (have) ----
  S('mui', 'Material UI', 'UI Libraries', /material[- ]?ui|\bmui\b/i, true, ['react']),
  S('shadcn', 'ShadCN UI', 'UI Libraries', /shadcn/i, true, ['react', 'tailwind']),
  S('chakra', 'Chakra UI', 'UI Libraries', /chakra/i, true, ['react']),
  S('daisyui', 'DaisyUI', 'UI Libraries', /daisy\s?ui/i, true, ['tailwind']),
  S('antd', 'Ant Design', 'UI Libraries', /ant\s?design|\bantd\b/i),

  // ---- Backend (have) ----
  S('java', 'Java', 'Backend', /\bjava\b(?!\s*script)|\bj2ee\b|\bjdk\b|\bjvm\b/i, true),
  S('springboot', 'Spring Boot', 'Backend', /spring\s?boot/i, true, ['java', 'spring', 'rest']),
  S('spring', 'Spring', 'Backend', /spring\s?(?:mvc|security|data|cloud|framework|core)|\bspring\b(?=[\s,/]*(?:java|hibernate|jpa))|java\W{1,3}spring\b/i, true, ['java']),
  S('hibernate', 'Hibernate', 'Backend', /hibernate|\bjpa\b/i, true, ['java']),
  S('nodejs', 'Node.js', 'Backend', /\bnode(?:\.?js)?\b|\bnodejs\b/i, true, ['javascript']),
  S('express', 'Express.js', 'Backend', /\bexpress\.?js\b|node\S{0,6}\s*[/+,]\s*express\b|express\s*[/+]\s*node|\bexpress\b(?=\s+(?:api|server|framework|middleware|routes?))/i, true, ['nodejs']),
  S('nestjs', 'NestJS', 'Backend', /\bnestjs\b|\bnest\.js\b/i, true, ['nodejs', 'typescript']),
  S('python', 'Python', 'Backend', /\bpython3?\b/i, true),
  S('fastapi', 'FastAPI', 'Backend', /fast\s?api/i, true, ['python', 'rest']),
  S('rest', 'REST APIs', 'Backend', /\brestful\b|\brest\s*(?:apis?|services?|endpoints?|web)\b|\bapis?\b|web services/i, true),
  S('websockets', 'WebSockets', 'Tools and DevOps', /websockets?|socket\.?io|real[- ]time/i, true),

  // ---- Backend (not on the resume) ----
  S('django', 'Django', 'Backend', /\bdjango\b|\bdrf\b/i, true, ['python']),
  S('flask', 'Flask', 'Backend', /\bflask\b/i, true, ['python']),
  S('maven', 'Maven', 'Backend', /\bmaven\b|\bgradle\b/i, true, ['java']),
  S('golang', 'Golang', 'Backend', /\bgolang\b|\bgo\s+(?:developer|engineer|backend|lang)\b/i),
  S('php', 'PHP', 'Backend', /\bphp\b/i),
  S('laravel', 'Laravel', 'Backend', /laravel|symfony|codeigniter/i, false, ['php']),
  S('dotnet', '.NET', 'Backend', /\.net\b|dotnet|asp\.net/i),
  S('csharp', 'C#', 'Backend', /\bc#|\bcsharp\b/i),
  S('ruby', 'Ruby on Rails', 'Backend', /\bruby\b|\brails\b/i),
  S('rust', 'Rust', 'Backend', /\brust\b/i),
  S('cpp', 'C++', 'Backend', /\bc\+\+|\bcpp\b/i),
  S('kotlin', 'Kotlin', 'Backend', /\bkotlin\b/i),
  S('scala', 'Scala', 'Backend', /\bscala\b/i),
  S('microservices', 'Microservices', 'Backend', /micro[- ]?services?/i),
  S('kafka', 'Kafka', 'Backend', /\bkafka\b|rabbitmq|\bsqs\b|message (?:queue|broker)/i),
  S('grpc', 'gRPC', 'Backend', /\bgrpc\b/i),

  // ---- Databases ----
  S('mysql', 'MySQL', 'Databases', /\bmysql\b|\bmariadb\b/i, true, ['sql']),
  S('postgres', 'PostgreSQL', 'Databases', /postgres(?:ql)?|\bpsql\b/i, true, ['sql']),
  S('mongodb', 'MongoDB', 'Databases', /mongo(?:\s?db)?|\bmongoose\b/i, true),
  S('oracle', 'Oracle SQL', 'Databases', /\boracle\b|pl\/?sql/i, true, ['sql']),
  S('sql', 'SQL', 'Databases', /\bsql\b|\brdbms\b|relational databases?/i, true),
  S('redis', 'Redis', 'Databases', /\bredis\b|memcached/i),
  S('nosql', 'NoSQL', 'Databases', /\bnosql\b|dynamodb|cassandra|couchbase/i),
  S('elasticsearch', 'Elasticsearch', 'Databases', /elastic\s?search|\bopensearch\b|\bsolr\b/i),
  S('snowflake', 'Snowflake / Data Warehouse', 'Databases', /snowflake|bigquery|redshift|data warehouse/i),

  // ---- Tools and DevOps ----
  S('git', 'Git', 'Tools and DevOps', /\bgit(?:hub|lab)?\b|version control|bitbucket/i, true),
  S('docker', 'Docker', 'Tools and DevOps', /\bdocker\b|container(?:s|ization)?/i, true),
  S('linux', 'Linux', 'Tools and DevOps', /\blinux\b|\bunix\b|\bbash\b|shell script/i, true),
  S('postman', 'Postman', 'Tools and DevOps', /\bpostman\b|\bswagger\b|openapi/i, true),
  S('figma', 'Figma', 'Tools and DevOps', /\bfigma\b|\bsketch\b|adobe xd/i, true),
  S('aws', 'AWS', 'Tools and DevOps', /\baws\b|amazon web services|\bec2\b|\bs3\b|lambda/i),
  S('azure', 'Azure', 'Tools and DevOps', /\bazure\b/i),
  S('gcp', 'Google Cloud', 'Tools and DevOps', /\bgcp\b|google cloud/i),
  S('kubernetes', 'Kubernetes', 'Tools and DevOps', /kubernetes|\bk8s\b|\bhelm\b/i),
  S('terraform', 'Terraform', 'Tools and DevOps', /terraform|ansible|infrastructure as code|\biac\b/i),
  S('cicd', 'CI/CD', 'Tools and DevOps', /ci\s?\/?\s?cd|jenkins|github actions|gitlab ci|circleci/i),
  S('testing', 'Testing', 'Tools and DevOps', /\bjest\b|\bcypress\b|\bselenium\b|\bjunit\b|\bplaywright\b|\bpytest\b|\bmocha\b|unit test|\btdd\b/i),

  // ---- Mobile ----
  S('reactnative', 'React Native', 'Mobile', /react[- ]native/i, true, ['react', 'javascript']),
  S('flutter', 'Flutter', 'Mobile', /\bflutter\b|\bdart\b/i),
  S('android', 'Android', 'Mobile', /\bandroid\b/i, true),
  S('firebase', 'Firebase', 'Mobile', /\bfirebase\b|firestore/i, true),
  S('expo', 'Expo', 'Mobile', /\bexpo\b/i, true, ['reactnative']),
  S('ios', 'iOS', 'Mobile', /\bios\b|swiftui|\bswift\b(?=\s*(?:developer|programming|language|\/|,))|objective[- ]c/i),

  // ---- Data / AI (not on the resume) ----
  S('ml', 'Machine Learning', 'Data', /machine learning|\bml\b|deep learning|\bllm\b|\bnlp\b|tensorflow|pytorch|scikit|computer vision|generative ai|\bgenai\b/i),
  S('pandas', 'Pandas', 'Data', /\bpandas\b/i, true, ['python']),
  S('numpy', 'NumPy', 'Data', /\bnumpy\b/i, true, ['python']),
  S('datasci', 'Data Science', 'Data', /data scien|data analy|power ?bi|tableau|\betl\b|data engineer|apache spark|pyspark|airflow/i),

  // ---- Business (exposure only) ----
  S('erp', 'ERP / SAP', 'Business', /\bsap\b|\berp\b|odoo|salesforce|dynamics 365/i),
  S('cms', 'CMS / E-commerce', 'Business', /wordpress|shopify|woocommerce|magento|webflow|\bcms\b|headless cms|strapi|contentful/i),
  S('blockchain', 'Blockchain', 'Business', /blockchain|web3|solidity|smart contract|\bdapp\b|ethereum/i),
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// ---- Roles. Title words weigh more than body words. Fit says how well the candidate can honestly cover the role. ----
// fit: 1 = direct match, 0.7 = close, 0.3 = stretch, 0 = not a fit
export const ROLES = [
  { id: 'mern', label: 'MERN Stack Developer', fit: 1, title: /\bmern\b/i, body: /\bmern\b|mongo.{0,40}express.{0,40}react.{0,40}node/i, skills: ['mongodb', 'express', 'react', 'nodejs'] },
  { id: 'nextjs', label: 'Next.js Developer', fit: 1, title: /\bnext(?:\.?js)?\s+(?:developer|engineer)/i, body: /\bnext\.?js\b/i, skills: ['nextjs', 'react'] },
  { id: 'react', label: 'React.js Developer', fit: 1, title: /\breact(?:\.?js)?\s+(?:developer|engineer|dev\b|frontend|front[- ]end)/i, body: /\breact(?:\.?js)?\b/i, skills: ['react', 'javascript'] },
  { id: 'fullstack', label: 'Full Stack Developer', fit: 1, title: /full[- ]?stack/i, body: /full[- ]?stack/i, skills: ['react', 'nodejs', 'javascript'] },
  { id: 'frontend', label: 'Frontend Developer', fit: 1, title: /front[- ]?end|\bui\s+(?:developer|engineer)|web ui/i, body: /front[- ]?end|\bui developer\b/i, skills: ['react', 'javascript', 'css'] },
  { id: 'java', label: 'Java Developer', fit: 1, title: /\bjava\s+(?:developer|engineer|backend|full)|spring\s?boot\s+(?:developer|engineer)|j2ee/i, body: /\bjava\b(?!\s*script)|spring\s?boot/i, skills: ['java', 'springboot'] },
  { id: 'python', label: 'Python Developer', fit: 1, title: /\bpython\s+(?:developer|engineer|backend|full)|fastapi\s+(?:developer|engineer)/i, body: /\bpython\b|fast\s?api/i, skills: ['python', 'fastapi'] },
  { id: 'node', label: 'Node.js Developer', fit: 1, title: /\bnode(?:\.?js)?\s+(?:developer|engineer|backend)|nestjs\s+(?:developer|engineer)/i, body: /\bnode(?:\.?js)?\b|\bnestjs\b|express\.?js/i, skills: ['nodejs', 'express'] },
  { id: 'backend', label: 'Backend Developer', fit: 1, title: /back[- ]?end|\bapi\s+(?:developer|engineer)|server[- ]side/i, body: /back[- ]?end|server[- ]side/i, skills: ['nodejs', 'java', 'python', 'rest'] },
  { id: 'angular', label: 'Angular Developer', fit: 0.7, title: /\bangular(?:\.?js)?\s+(?:developer|engineer)/i, body: /\bangular/i, skills: ['angular', 'typescript'] },
  { id: 'webdev', label: 'Web Developer', fit: 0.9, title: /\bweb\s+(?:developer|engineer)|software\s+(?:developer|engineer)|\bsde\b|\bswe\b|javascript\s+developer|typescript\s+developer/i, body: /web developer|software (?:developer|engineer)/i, skills: ['javascript', 'react'] },
  { id: 'freelance', label: 'Freelance Developer', fit: 0.9, title: /freelanc|contract(?:or)?\b|part[- ]time/i, body: /freelanc|contract(?:or)?\b|part[- ]time|short[- ]term project/i, skills: ['react', 'nodejs'] },
  { id: 'intern', label: 'Software Developer', fit: 0.9, title: /\bintern(?:ship)?\b|fresher|entry[- ]level|graduate|trainee/i, body: /\bintern(?:ship)?\b|fresher|entry[- ]level|trainee/i, skills: ['javascript'] },
  { id: 'php', label: 'PHP Developer', fit: 0.2, title: /\bphp\b|laravel/i, body: /\bphp\b|laravel/i, skills: ['php'] },
  { id: 'dotnet', label: '.NET Developer', fit: 0, title: /\.net\b|c#/i, body: /\.net\b|\bc#/i, skills: ['dotnet'] },
  { id: 'mobile', label: 'Mobile Developer', fit: 0.8, title: /android|\bios\b|flutter|react[- ]native|mobile app/i, body: /android|\bios\b|flutter|react[- ]native/i, skills: ['reactnative', 'android'] },
  { id: 'devops', label: 'DevOps Engineer', fit: 0, title: /devops|\bsre\b|site reliability|platform engineer|cloud engineer|infrastructure/i, body: /devops|\bsre\b|kubernetes|terraform/i, skills: ['kubernetes', 'aws'] },
  { id: 'data', label: 'Data / ML Engineer', fit: 0, title: /data\s+(?:scien|analy|engineer)|machine learning|\bml\b|\bai\s+engineer|\bllm\b/i, body: /machine learning|data scien/i, skills: ['ml', 'datasci'] },
  { id: 'qa', label: 'QA Engineer', fit: 0, title: /\bqa\b|\bsdet\b|test(?:er|ing)\s+engineer|quality assurance/i, body: /\bqa\b|quality assurance/i, skills: ['testing'] },
  { id: 'design', label: 'Designer', fit: 0, title: /ui\s?\/?\s?ux|product designer|graphic designer|ux designer/i, body: /ux designer|product designer/i, skills: ['figma'] },
  { id: 'golang', label: 'Golang Developer', fit: 0.1, title: /golang|\bgo\s+(?:developer|engineer)/i, body: /golang/i, skills: ['golang'] },
  { id: 'blockchain', label: 'Blockchain Developer', fit: 0.1, title: /blockchain|web3|solidity/i, body: /blockchain|solidity/i, skills: ['blockchain'] },
  { id: 'manager', label: 'Manager', fit: 0, title: /\b(?:engineering|product|project|delivery)\s+manager|\bvp\b|head of|director|\bcto\b/i, body: /engineering manager|head of engineering/i, skills: [] },
];

// ---- Seniority and experience ----
export const SENIOR_RE = /\bsenior\b|\bsr\.?\s|\blead\b|\bprincipal\b|\bstaff\b|\barchitect\b|\bmanager\b|\bhead\b/i;
export const JUNIOR_RE = /\bjunior\b|\bjr\.?\s|\bentry[- ]level\b|\bfresher|\bintern(?:ship)?\b|\bgraduate\b|\btrainee\b|0\s?-\s?[12]\s*(?:yrs?|years)|1\s?-\s?3\s*(?:yrs?|years)/i;

// How many years the candidate honestly has (Front-End Nov 2024 onwards). Update when time passes.
export const MY_YEARS = 2;

// Signals picked up from the post
export const SIGNALS = {
  remote: /\bremote\b|work from home|\bwfh\b|anywhere/i,
  immediate: /immediate(?:ly)? (?:joiner|join|start)|join(?:ing)? immediately|asap|urgent(?:ly)? (?:hiring|required|need)/i,
  // jobs open only to people in a region that does not include India
  regionLock: /\b(?:us|usa|u\.s\.|united states|north america|americas|eu|europe|uk|canada|australia)\s*(?:only|based|residents?|citizens?|time ?zones?)|remote\s*\((?:us|usa|u\.s\.|americas|eu|europe|uk|canada|north america)|must (?:be )?(?:based|located|reside) in|(?:us|eu|uk)\s*\/\s*(?:eu|us|uk)[- ]overlap|(?:eu|us|uk)[- ]overlap|work authori[sz]ation|right to work/i,
  onsite: /\bon[- ]?site\b|in[- ]person|\bhybrid\b|in[- ]office|office[- ]based/i,
  onsiteOnly: /\bon[- ]?site only\b|no remote|must (?:be )?(?:located|relocate)|relocat(?:e|ion) required/i,
  visa: /visa sponsorship (?:not available|unavailable)|must be authorized to work|us citizens? only|\bgreen card\b|security clearance/i,
};
