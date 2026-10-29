// Master resume as data. The tailor only reorders and selects from this, it never adds anything.
// Every sentence below comes from the candidate's real resume. Do not add claims that are not true.

export const MASTER = {
  name: 'Satyam Soni',
  location: 'Gurugram, India',
  phone: '+91 9696050128',
  email: 'satyam.soni1312@gmail.com',
  linkedin: 'linkedin.com/in/satyam-soni-833873293',
  github: 'github.com/satyamsoni853',

  // Summary sentence per role. `default` is the full stack one.
  summaries: {
    default:
      'Full Stack Developer with experience building responsive web applications using React.js and Next.js, and backend services using Spring Boot, FastAPI and Express.js. Strong knowledge of REST APIs, SQL databases and clean architecture. Experience integrating third-party APIs and ERP business workflows, with exposure to Angular and SAP environments. Available immediately.',
    frontend:
      'Frontend Developer who builds responsive, animated web interfaces with React.js and Next.js, using TypeScript, Redux, Tailwind CSS and Material UI. Experience integrating REST APIs and adding real-time features with WebSockets. Also works on backend services with Spring Boot, FastAPI and Express.js. Available immediately.',
    react:
      'React.js Developer who builds responsive web applications with React.js and Next.js, using TypeScript, Redux, Tailwind CSS and Material UI. Experience integrating REST APIs and real-time features with WebSockets, and working across the stack with Node.js, Spring Boot and FastAPI. Available immediately.',
    nextjs:
      'Next.js Developer who builds responsive, performance-focused web applications with Next.js and React.js, including server-side rendering, REST API integration and animated interfaces. Also works on backend services with Express.js, Spring Boot and FastAPI. Available immediately.',
    backend:
      'Backend Developer skilled in Java (Spring Boot, Hibernate), Python (FastAPI) and Node.js (Express.js, NestJS), building REST APIs on MySQL, PostgreSQL and MongoDB. Experience integrating third-party APIs and ERP business workflows, with a frontend background in React.js and Next.js. Available immediately.',
    java:
      'Java Developer skilled in Spring Boot, Spring and Hibernate, building REST APIs on MySQL, PostgreSQL and Oracle SQL. Experience integrating third-party APIs and ERP business workflows, with exposure to SAP environments, and a frontend background in React.js and Next.js. Available immediately.',
    python:
      'Python Developer skilled in FastAPI and REST API design on MySQL, PostgreSQL and MongoDB. Experience integrating third-party APIs and ERP business workflows, with a frontend background in React.js and Next.js for end to end delivery. Available immediately.',
    node:
      'Node.js Developer skilled in Express.js and NestJS, building REST APIs on MongoDB, MySQL and PostgreSQL, with a frontend background in React.js and Next.js for end to end delivery. Experience with real-time features using WebSockets. Available immediately.',
    mern:
      'MERN Stack Developer who builds web applications with MongoDB, Express.js, React.js and Node.js, along with Next.js, TypeScript and REST API integration. Experience adding real-time features with WebSockets. Available immediately.',
    angular:
      'Full Stack Developer with exposure to Angular-based applications, and experience with React.js, Next.js and TypeScript on the frontend and Spring Boot, FastAPI and Express.js on the backend. Available immediately.',
    freelance:
      'Full Stack Developer available for project-based and contract work. Has delivered a travel booking website end to end as a remote, project-based developer, using React.js and Next.js on the frontend and REST APIs and databases on the backend. Available immediately.',
    intern:
      'Computer Science graduate (B.Tech, 2025) and Full Stack Developer with hands-on experience in React.js, Next.js, Spring Boot, FastAPI and Express.js, gained in a startup and a remote project role. Available immediately.',
    webdev:
      'Software Developer with experience building web applications end to end using React.js and Next.js on the frontend and Spring Boot, FastAPI and Express.js on the backend. Strong knowledge of REST APIs, SQL databases and clean architecture. Available immediately.',
  },

  // Skill groups in default order. Ids refer to kb.js. Only skills the candidate really has.
  skillGroups: [
    { group: 'Frontend', ids: ['react', 'nextjs', 'angular', 'redux', 'javascript', 'typescript', 'html', 'css', 'tailwind', 'graphql', 'gsap'] },
    { group: 'Backend', ids: ['java', 'springboot', 'spring', 'hibernate', 'nodejs', 'express', 'nestjs', 'python', 'fastapi', 'rest'] },
    { group: 'Databases', ids: ['mysql', 'postgres', 'mongodb', 'oracle', 'sql'] },
    { group: 'Tools and DevOps', ids: ['git', 'docker', 'linux', 'postman', 'figma', 'websockets'] },
    { group: 'UI Libraries', ids: ['mui', 'shadcn', 'chakra', 'daisyui'] },
  ],

  experience: [
    {
      title: 'Full Stack Developer',
      company: 'Cloudfire IT Services',
      place: 'Gurugram, India (Remote)',
      dates: 'Nov 2025 - Present',
      bullets: [
        { text: 'Build a travel booking website end to end as a project-based full stack developer, covering frontend, backend and database work.', tags: ['nextjs', 'react', 'rest', 'sql'] },
        { text: 'Developed the frontend in Next.js with responsive layouts, smooth navigation and cross-device compatibility.', tags: ['nextjs', 'react', 'css', 'html', 'responsive'] },
        { text: 'Integrated REST APIs to fetch, validate and display travel listings, search results, user data and booking details, with error handling between frontend and server.', tags: ['rest', 'javascript', 'nodejs'] },
      ],
    },
    {
      title: 'Front-End Developer',
      company: 'Uniisphere Unified Pvt Ltd',
      place: 'Gurugram, India',
      dates: 'Nov 2024 - Nov 2025',
      bullets: [
        { text: 'Built responsive, animated interfaces for an early-stage unified job portal and social media platform using Next.js, React.js, Material UI and ShadCN UI.', tags: ['nextjs', 'react', 'mui', 'shadcn', 'responsive', 'css'] },
        { text: 'Implemented real-time chat and activity updates using WebSockets.', tags: ['websockets', 'javascript'] },
        { text: 'Integrated multiple REST APIs for authentication, jobs, profiles, posts and notifications.', tags: ['rest', 'javascript'] },
      ],
    },
  ],

  projects: [
    { name: 'SunspotsHolidays', site: 'sunspotsholidays.com', text: 'Full stack travel booking platform to search and book flights, hotels and car rentals, with real-time search, secure authentication and booking management.', tags: ['rest', 'sql', 'websockets'] },
    { name: 'Ashwinisdresearch', site: 'ashwinisdresearch.com', text: 'Website for a trading education company providing educational resources on financial markets.', tags: ['html', 'css', 'javascript'] },
    { name: 'Portfolio Website', site: 'satyam-soni-video.vercel.app', text: 'Next.js portfolio with server-side performance optimization, Framer Motion animations and Material UI.', tags: ['nextjs', 'react', 'mui', 'framer'] },
  ],

  education: {
    degree: 'B.Tech in Computer Science',
    school: 'Kamala Nehru Institute of Physical and Social Sciences',
    place: 'Sultanpur, India',
    dates: '2021 - 2025',
    other: 'Higher Secondary (12th): Sangam Modern Inter College, Sultanpur | Secondary (10th): Maharishi Vidya Mandir, Prayagraj',
  },

  // Short facts the cover note may use, per tag. Kept to what the resume shows.
  noteFacts: {
    default: 'Most recently I built a travel booking platform end to end, covering the Next.js frontend, REST API integration and the search and booking flows.',
    realtime: 'I built real-time chat and activity updates with WebSockets for a job portal and social platform.',
    backend: 'Most recently I worked on the API integration and backend connectivity of a travel booking platform, handling data validation, error handling and the booking flows.',
    frontend: 'Most recently I built the Next.js frontend of a travel booking platform with responsive layouts, and before that animated React interfaces for a job portal and social platform.',
    freelance: 'I currently work project-based and remote, and delivered a travel booking website end to end.',
  },
};
