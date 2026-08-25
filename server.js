const express = require('express');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 10000;

// 🟢 MongoDB Connection (Render Environment Variable থেকে নেবে)
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ CRITICAL ERROR: MONGO_URI Environment Variable is missing in Render!');
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log('🟢 MongoDB Connected Successfully!'))
        .catch(err => console.error('❌ MongoDB Connection Error:', err));
}

// 🟢 MongoDB Schemas & Models
const movieSchema = new mongoose.Schema({
    title: String,
    category: String,
    poster: String,
    videoLinks: [{ name: String, url: String }],
    isPinned: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
    adminPassword: { type: String, default: "admin" },
    categories: { type: [String], default: ["Drama", "Action", "Hindi Movie", "Bangla Movie", "Thriller"] }
});

const Movie = mongoose.model('Movie', movieSchema);
const Settings = mongoose.model('Settings', settingsSchema);

// 🟢 Helper Function for Default Settings
async function getSettings() {
    let settings = await Settings.findOne();
    if (!settings) {
        settings = await Settings.create({
            adminPassword: "admin",
            categories: ["Drama", "Action", "Hindi Movie", "Bangla Movie", "Thriller"]
        });
    }
    return settings;
}

// 🟢 Express Configurations
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

// 🟢 Multer Storage Setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public/uploads'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});
const upload = multer({ storage });

// 🟢 Admin Auth Middleware
function isAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    res.redirect('/admin/login');
}

// ==================== PUBLIC ROUTES ====================

// Home Page
app.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        const selectedCategory = req.query.category || '';
        
        let query = {};
        if (selectedCategory) {
            query.category = selectedCategory;
        }

        let movies = await Movie.find(query).sort({ isPinned: -1, createdAt: -1 });

        const limit = 6;
        const page = parseInt(req.query.page) || 1;
        const totalPages = Math.ceil(movies.length / limit) || 1;
        const startIndex = (page - 1) * limit;

        const paginatedMovies = movies.slice(startIndex, startIndex + limit);
        const popularMovies = await Movie.find().sort({ views: -1 }).limit(5);

        res.render('index', {
            categories: settings.categories,
            selectedCategory,
            recentMovies: paginatedMovies,
            popularMovies,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// Single Movie View Page
app.get('/movie/:id', async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        if (!movie) return res.status(404).send('Movie Not Found');

        movie.views = (movie.views || 0) + 1;
        await movie.save();

        const relatedMovies = await Movie.find({ 
            _id: { $ne: movie._id }, 
            category: movie.category 
        }).limit(5);

        res.render('movie', { movie, relatedMovies });
    } catch (err) {
        res.status(404).send('Invalid Movie ID');
    }
});

// Search Route
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
            categories: settings.categories,
            searchQuery,
            movies: searchResults
        });
    } catch (err) {
        res.status(500).send('Search Error');
    }
});

// ==================== ADMIN ROUTES ====================

// Admin Login GET
app.get('/admin/login', (req, res) => {
    res.render('login', { error: null });
});

// Admin Login POST
app.post('/admin/login', async (req, res) => {
    const settings = await getSettings();
    if (req.body.password === settings.adminPassword) {
        req.session.isAdmin = true;
        res.redirect('/admin');
    } else {
        res.render('login', { error: 'Wrong Password!' });
    }
});

// Admin Logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Admin Dashboard GET
app.get('/admin', isAdmin, async (req, res) => {
    const settings = await getSettings();
    const movies = await Movie.find().sort({ createdAt: -1 });
    const movieToEdit = req.query.edit ? await Movie.findById(req.query.edit) : null;

    res.render('admin', {
        categories: settings.categories,
        movies,
        movieToEdit,
        msg: req.query.msg || null,
        err: req.query.err || null
    });
});

// Change Password POST
app.post('/admin/change-password', isAdmin, async (req, res) => {
    const settings = await getSettings();
    const { oldPassword, newPassword } = req.body;

    if (oldPassword === settings.adminPassword) {
        settings.adminPassword = newPassword;
        await settings.save();
        res.redirect('/admin?msg=Password+changed+successfully!');
    } else {
        res.redirect('/admin?err=Old+password+does+not+match!');
    }
});

// Toggle Pin Status POST
app.post('/admin/toggle-pin/:id', isAdmin, async (req, res) => {
    const movie = await Movie.findById(req.params.id);
    if (movie) {
        movie.isPinned = !movie.isPinned;
        await movie.save();
    }
    res.redirect('/admin');
});

// Add / Edit Movie POST
app.post('/admin/save-movie', isAdmin, upload.single('posterFile'), async (req, res) => {
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
                    url 
                });
            }
        });
    } else if (linkUrl) {
        videoLinks.push({ name: linkName || 'Server 1', url: linkUrl });
    }

    if (id) {
        const updateData = { 
            title, 
            category, 
            videoLinks, 
            isPinned: isPinned === 'on' 
        };
        if (poster) updateData.poster = poster;
        await Movie.findByIdAndUpdate(id, updateData);
    } else {
        await Movie.create({
            title,
            category,
            poster: poster || 'https://via.placeholder.com/300x400?text=No+Poster',
            videoLinks,
            isPinned: isPinned === 'on'
        });
    }

    res.redirect('/admin?msg=Movie+saved+successfully!');
});

// Delete Movie POST
app.post('/admin/delete-movie/:id', isAdmin, async (req, res) => {
    await Movie.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
});

// Add Category POST
app.post('/admin/add-category', isAdmin, async (req, res) => {
    const settings = await getSettings();
    if (req.body.categoryName && !settings.categories.includes(req.body.categoryName)) {
        settings.categories.push(req.body.categoryName);
        await settings.save();
    }
    res.redirect('/admin');
});

// Delete Category POST
app.post('/admin/delete-category', isAdmin, async (req, res) => {
    const settings = await getSettings();
    settings.categories = settings.categories.filter(c => c !== req.body.categoryName);
    await settings.save();
    res.redirect('/admin');
});

// Server Start
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
