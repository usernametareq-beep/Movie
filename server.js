const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(session({
    secret: 'moviehouse_secret_key_123',
    resave: false,
    saveUninitialized: true
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage });

const dataPath = path.join(__dirname, 'data.json');

function getData() {
    if (!fs.existsSync(dataPath)) {
        const initialData = {
            adminPassword: "admin",
            categories: ["Drama", "Action", "Hindi Movie", "Bangla Movie", "Thriller"],
            movies: []
        };
        fs.writeFileSync(dataPath, JSON.stringify(initialData, null, 2));
    }
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

function saveData(data) {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function isAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin/login');
}

// ---------------- ROUTES ----------------

// Home Route
app.get('/', (req, res) => {
    const db = getData();
    let movies = db.movies || [];
    const categories = db.categories || [];
    const selectedCategory = req.query.category || '';

    if (selectedCategory) {
        movies = movies.filter(m => m.category === selectedCategory);
    }

    movies.sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));

    const limit = 5;
    const page = parseInt(req.query.page) || 1;
    const totalPages = Math.ceil(movies.length / limit) || 1;
    const startIndex = (page - 1) * limit;

    const paginatedMovies = movies.slice(startIndex, startIndex + limit);

    const popularMovies = [...(db.movies || [])]
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5);

    res.render('index', {
        categories,
        selectedCategory,
        recentMovies: paginatedMovies,
        popularMovies,
        currentPage: page,
        totalPages
    });
});

// Single Movie Watch Page Route (সরাসরি প্লে পেজ)
app.get('/movie/:id', (req, res) => {
    const db = getData();
    const movie = db.movies.find(m => m.id === req.params.id);

    if (!movie) {
        return res.status(404).send('Movie Not Found');
    }

    // View Count বাড়ানো
    movie.views = (movie.views || 0) + 1;
    saveData(db);

    const relatedMovies = db.movies
        .filter(m => m.id !== movie.id && m.category === movie.category)
        .slice(0, 5);

    res.render('movie', {
        movie,
        relatedMovies
    });
});

// Search Route
app.get('/search', (req, res) => {
    const db = getData();
    const categories = db.categories || [];
    const searchQuery = (req.query.q || '').trim().toLowerCase();

    let searchResults = [];
    if (searchQuery) {
        searchResults = (db.movies || []).filter(movie => 
            movie.title && movie.title.toLowerCase().includes(searchQuery)
        );
    }

    res.render('search', {
        categories,
        searchQuery: req.query.q || '',
        movies: searchResults
    });
});

// Admin Routes
app.get('/admin/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/admin/login', (req, res) => {
    const db = getData();
    if (req.body.password === db.adminPassword) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('login', { error: 'Wrong Password!' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

app.get('/admin', isAdmin, (req, res) => {
    const db = getData();
    const movieToEdit = req.query.edit ? db.movies.find(m => m.id === req.query.edit) : null;

    res.render('admin', {
        categories: db.categories,
        movies: db.movies,
        movieToEdit,
        msg: req.query.msg || null,
        err: req.query.err || null
    });
});

app.post('/admin/save-movie', isAdmin, upload.single('posterFile'), (req, res) => {
    const db = getData();
    const { id, title, category, posterUrl, linkName, linkUrl, isPinned } = req.body;

    let poster = posterUrl || '';
    if (req.file) {
        poster = '/uploads/' + req.file.filename;
    }

    const videoLinks = [];
    if (Array.isArray(linkUrl)) {
        linkUrl.forEach((url, i) => {
            if (url) {
                videoLinks.push({
                    name: (linkName && linkName[i]) ? linkName[i] : `Server ${i + 1}`,
                    url: url
                });
            }
        });
    } else if (linkUrl) {
        videoLinks.push({
            name: linkName || 'Server 1',
            url: linkUrl
        });
    }

    if (id) {
        const idx = db.movies.findIndex(m => m.id === id);
        if (idx !== -1) {
            db.movies[idx].title = title;
            db.movies[idx].category = category;
            if (poster) db.movies[idx].poster = poster;
            db.movies[idx].videoLinks = videoLinks;
            db.movies[idx].isPinned = isPinned === 'on';
        }
    } else {
        db.movies.unshift({
            id: Date.now().toString(),
            title,
            category,
            poster: poster || 'https://via.placeholder.com/300x400?text=No+Poster',
            videoLinks,
            isPinned: isPinned === 'on',
            views: 0
        });
    }

    saveData(db);
    res.redirect('/admin?msg=success');
});

app.post('/admin/delete-movie/:id', isAdmin, (req, res) => {
    const db = getData();
    db.movies = db.movies.filter(m => m.id !== req.params.id);
    saveData(db);
    res.redirect('/admin');
});

app.post('/admin/add-category', isAdmin, (req, res) => {
    const db = getData();
    if (req.body.categoryName && !db.categories.includes(req.body.categoryName)) {
        db.categories.push(req.body.categoryName);
        saveData(db);
    }
    res.redirect('/admin');
});

app.post('/admin/delete-category', isAdmin, (req, res) => {
    const db = getData();
    db.categories = db.categories.filter(c => c !== req.body.categoryName);
    saveData(db);
    res.redirect('/admin');
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});