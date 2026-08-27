const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ CRITICAL ERROR: MONGO_URI Environment Variable is missing in Render!');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('🟢 MongoDB Connected Successfully!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// 🟢 MongoDB Schemas
const movieSchema = new mongoose.Schema({
    title: String,
    category: String,
    poster: String,
    contentType: { type: String, default: 'movie' },
    videoLinks: [{ name: String, url: String }],
    episodes: [{
        season: Number,
        episodeNumber: Number,
        name: String, // EJS-এর epName এবং Frontend সংগতি রাখার জন্য 'name' ব্যবহার করা হয়েছে
        url: String
    }],
    isPinned: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
    adminPassword: { type: String, default: "admin" },
    categories: { type: [String], default: ["Drama", "Action", "Hindi Movie", "Bangla Movie", "Thriller", "Web Series"] }
});

const Movie = mongoose.model('Movie', movieSchema);
const Settings = mongoose.model('Settings', settingsSchema);

async function getSettings() {
    try {
        let settings = await Settings.findOne();
        if (!settings) {
            settings = await Settings.create({
                adminPassword: "admin",
                categories: ["Drama", "Action", "Hindi Movie", "Bangla Movie", "Thriller", "Web Series"]
            });
        }
        return settings;
    } catch (err) {
        return {
            adminPassword: "admin",
            categories: ["Drama", "Action", "Hindi Movie", "Bangla Movie", "Thriller", "Web Series"]
        };
    }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

app.use(session({
    secret: 'moviehouse_secret_key_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage });

function isAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin/login');
}

// 🟢 Embed URL Converter Helper (YouTube সহ সব ধরনের ভিডিও প্লে করার জন্য)
function cleanEmbedUrl(url) {
    if (!url) return '';
    let clean = url.trim();

    // IFRAME tag থেকে src বের করার জন্য
    if (clean.includes('<iframe')) {
        const match = clean.match(/src=["']([^"']+)["']/);
        if (match && match[1]) clean = match[1];
    }

    // YouTube Normal Link to Embed URL conversion
    if (clean.includes('youtube.com/watch?v=')) {
        const videoId = clean.split('v=')[1].split('&')[0];
        return `https://www.youtube.com/embed/${videoId}`;
    }
    if (clean.includes('youtu.be/')) {
        const videoId = clean.split('youtu.be/')[1].split('?')[0];
        return `https://www.youtube.com/embed/${videoId}`;
    }

    return clean;
}

// ==================== PUBLIC ROUTES ====================

app.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        const selectedCategory = req.query.category || '';
        const searchQuery = (req.query.q || '').trim();
        
        let query = {};
        if (selectedCategory) query.category = selectedCategory;
        if (searchQuery) query.title = { $regex: searchQuery, $options: 'i' };

        let allMovies = await Movie.find(query).sort({ isPinned: -1, createdAt: -1 }) || [];

        const limit = 6;
        const page = parseInt(req.query.page) || 1;
        const totalPages = Math.ceil(allMovies.length / limit) || 1;
        const startIndex = (page - 1) * limit;

        const paginatedMovies = allMovies.slice(startIndex, startIndex + limit);
        const popularMovies = await Movie.find().sort({ views: -1 }).limit(5) || [];

        res.render('index', {
            categories: settings.categories || [],
            selectedCategory,
            activeCat: selectedCategory,
            searchQuery: searchQuery || '',
            movies: paginatedMovies,
            recentMovies: paginatedMovies,
            popularMovies,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// 🟢 Category Route
app.get('/category/:name', async (req, res) => {
    try {
        const categoryName = decodeURIComponent(req.params.name).trim();
        const settings = await getSettings();

        let allMovies = await Movie.find({ category: categoryName }).sort({ isPinned: -1, createdAt: -1 }) || [];

        const limit = 6;
        const page = parseInt(req.query.page) || 1;
        const totalPages = Math.ceil(allMovies.length / limit) || 1;
        const startIndex = (page - 1) * limit;

        const paginatedMovies = allMovies.slice(startIndex, startIndex + limit);
        const popularMovies = await Movie.find().sort({ views: -1 }).limit(5) || [];

        res.render('index', {
            categories: settings.categories || [],
            selectedCategory: categoryName,
            activeCat: categoryName,
            searchQuery: '',
            movies: paginatedMovies,
            recentMovies: paginatedMovies,
            popularMovies,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        res.status(500).send('Category Error');
    }
});

app.get('/movie/:id', async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (!movie) return res.status(404).send('Movie Not Found');

        movie.views = (movie.views || 0) + 1;
        await movie.save();

        const relatedMovies = await Movie.find({ 
            _id: { $ne: movie._id }, 
            category: movie.category 
        }).limit(5) || [];

        res.render('movie', { movie, relatedMovies });
    } catch (err) {
        res.status(404).send('Invalid Movie ID');
    }
});

app.get('/search', async (req, res) => {
    try {
        const settings = await getSettings();
        const searchQuery = (req.query.q || '').trim();

        let searchResults = [];
        if (searchQuery) {
            searchResults = await Movie.find({ 
                title: { $regex: searchQuery, $options: 'i' } 
            });
        }

        res.render('search', {
            categories: settings.categories || [],
            searchQuery,
            activeCat: '',
            movies: searchResults
        });
    } catch (err) {
        res.status(500).send('Search Error');
    }
});

// ==================== ADMIN ROUTES ====================

app.get('/admin/login', (req, res) => {
    if (req.session && req.session.isAdmin) return res.redirect('/admin');
    res.render('login', { error: null });
});

app.post('/admin/login', async (req, res) => {
    try {
        const settings = await getSettings();
        if (req.body.password === settings.adminPassword) {
            req.session.isAdmin = true;
            req.session.save((err) => {
                if (err) return res.render('login', { error: 'Session Error!' });
                res.redirect('/admin');
            });
        } else {
            res.render('login', { error: 'Wrong Password!' });
        }
    } catch (err) {
        res.render('login', { error: 'Login Failed!' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
});

app.get('/admin', isAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        const movies = await Movie.find().sort({ createdAt: -1 }) || [];
        const movieToEdit = req.query.edit ? await Movie.findById(req.query.edit) : null;

        res.render('admin', {
            categories: settings.categories || [],
            movies,
            movieToEdit,
            msg: req.query.msg || null,
            err: req.query.err || null
        });
    } catch (err) {
        res.status(500).send("Admin Error");
    }
});

// 🟢 Save Movie Action Route
app.post('/admin/save-movie', isAdmin, upload.single('posterFile'), async (req, res) => {
    try {
        const { id, title, category, contentType, posterUrl, linkName, linkUrl, epSeason, epNum, epNumber, epName, epTitle, epUrl, isPinned } = req.body;

        let poster = posterUrl || '';
        if (req.file) poster = '/uploads/' + req.file.filename;

        const pinnedStatus = isPinned === 'on' || isPinned === 'true' || isPinned === true;

        const videoLinks = [];
        if (Array.isArray(linkUrl)) {
            linkUrl.forEach((url, i) => {
                if (url && url.trim()) {
                    videoLinks.push({
                        name: (linkName && linkName[i]) ? linkName[i] : `Server ${i + 1}`,
                        url: cleanEmbedUrl(url)
                    });
                }
            });
        } else if (linkUrl && linkUrl.trim()) {
            videoLinks.push({
                name: linkName || 'Server 1',
                url: cleanEmbedUrl(linkUrl)
            });
        }

        const episodes = [];
        const seasonsInput = epSeason;
        const numbersInput = epNumber || epNum;
        const namesInput = epName || epTitle;

        if (Array.isArray(epUrl)) {
            epUrl.forEach((url, i) => {
                if (url && url.trim()) {
                    episodes.push({
                        season: (seasonsInput && seasonsInput[i]) ? parseInt(seasonsInput[i]) : 1,
                        episodeNumber: (numbersInput && numbersInput[i]) ? parseInt(numbersInput[i]) : (i + 1),
                        name: (namesInput && namesInput[i]) ? namesInput[i] : `Episode ${i + 1}`,
                        url: cleanEmbedUrl(url)
                    });
                }
            });
        } else if (epUrl && epUrl.trim()) {
            episodes.push({
                season: seasonsInput ? parseInt(seasonsInput) : 1,
                episodeNumber: numbersInput ? parseInt(numbersInput) : 1,
                name: namesInput || 'Episode 1',
                url: cleanEmbedUrl(epUrl)
            });
        }

        const movieData = {
            title,
            category,
            contentType: contentType || 'movie',
            videoLinks,
            episodes,
            isPinned: pinnedStatus
        };

        if (poster) movieData.poster = poster;

        if (id) {
            await Movie.findByIdAndUpdate(id, movieData);
        } else {
            if (!movieData.poster) movieData.poster = 'https://via.placeholder.com/300x400?text=No+Poster';
            await Movie.create(movieData);
        }

        res.redirect('/admin?msg=Saved+successfully!');
    } catch (err) {
        console.error("Save Error:", err);
        res.redirect('/admin?err=Save+failed!');
    }
});

// 🟢 Toggle Pin Route
app.post('/admin/toggle-pin/:id', isAdmin, async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (movie) {
            movie.isPinned = !movie.isPinned;
            await movie.save();
        }
        res.redirect('/admin');
    } catch (err) {
        res.redirect('/admin?err=Toggle+pin+failed!');
    }
});

app.post('/admin/delete-movie/:id', isAdmin, async (req, res) => {
    try {
        await Movie.findByIdAndDelete(req.params.id);
        res.redirect('/admin');
    } catch (err) {
        res.redirect('/admin?err=Delete+failed!');
    }
});

app.post('/admin/add-category', isAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        if (req.body.categoryName && !settings.categories.includes(req.body.categoryName.trim())) {
            settings.categories.push(req.body.categoryName.trim());
            await settings.save();
        }
        res.redirect('/admin');
    } catch (err) {
        res.redirect('/admin?err=Category+add+failed!');
    }
});

app.post('/admin/delete-category', isAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        settings.categories = settings.categories.filter(c => c !== req.body.categoryName);
        await settings.save();
        res.redirect('/admin');
    } catch (err) {
        res.redirect('/admin?err=Category+delete+failed!');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
