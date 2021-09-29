const puppeteer = require("puppeteer");
const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const url = require("url");
const { Cluster } = require("puppeteer-cluster");
const PDFDocument = require("pdfkit");
var sizeOf = require("image-size");
const path = require("path");
const fs = require("fs");
const tempDir = "downloads/temp";
const downloadsDir = "downloads";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  // eslint-disable-line global-require
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
  });

  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Listen for app to be ready
app.on("ready", function () {
  // Create new window
  mainWindow = new BrowserWindow({
    width: 530,
    height: 313,
    webPreferences: {
      nodeIntegration: true,
    },
  });
  // Load html in window
  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "index.html"),
      protocol: "file:",
      slashes: true,
    })
  );
  // Quit app when closed
  mainWindow.on("closed", function () {
    app.quit();
  });

  // Build menu from template
  const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
  // Insert menu
  Menu.setApplicationMenu(mainMenu);
});

// Catch document:get
ipcMain.on("document:get", function (e, idbook, docName) {
  /* let anyError = getDocument(idbook);
  anyError.then((e) => {
    console.log("finished");
    mainWindow.webContents.send("state:finished");    
  }); */

  getDocument(idbook, docName).then(() => {
    mainWindow.webContents.send("state:finished");
  });

  //mainWindow.webContents.send("item:add", item);
  //addWindow.close();
  // Still have a reference to addWindow in memory. Need to reclaim memory (Grabage collection)
  //addWindow = null;
});

// Create menu template
const mainMenuTemplate = [
  // Each object is a dropdown
  {
    label: "File",
    submenu: [
      {
        label: "Quit",
        accelerator: process.platform == "darwin" ? "Command+Q" : "Ctrl+Q",
        click() {
          app.quit();
        },
      },
    ],
  },
];

// If OSX, add empty object to menu
if (process.platform == "darwin") {
  mainMenuTemplate.unshift({});
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

let getDocument = async (idbook, docName) => {
  try {
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }
    }
    //

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const initPage = await browser.newPage();
    await initPage.goto(`https://es.scribd.com/embeds/${idbook}/content?start_page=1`);
    //!Numero de paginas
    const elementPages = await initPage.$(".total_pages");
    const textPages = await initPage.evaluate((elementPages) => elementPages.textContent, elementPages);
    const pagesNumber = textPages.match(/\d+/)[0];
    console.log(pagesNumber);

    // Create a cluster with 2 workers
    const cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_CONTEXT,
      maxConcurrency: 3,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    /*  doc.pipe(fs.createWriteStream("output.pdf")); */
    // Define a task (in this case: screenshot of page)
    await cluster.task(async ({ page, data: url }) => {
      await page.setViewport({
        width: 800,
        height: 800,
        deviceScaleFactor: 2.5,
      });
      await page.goto(url, { waitUntil: "networkidle2" });

      //!Eliminate
      await page.evaluate(() => {
        let example = document.querySelector(".toolbar_drop");
        let example3 = document.querySelector("#fb-root");
        let example4 = document.querySelector(".mobile_overlay");
        let example5 = document.querySelector("#font_preload_bed");
        let example6 = document.querySelector(".osano-cm-window__dialog");

        example.parentNode.removeChild(example);
        example3.parentNode.removeChild(example3);
        example4.parentNode.removeChild(example4);
        example5.parentNode.removeChild(example5);
        example6.parentNode.removeChild(example6);
      });
      //elemento
      let actualPage = url.match(/start_page=(\d+)/)[1];
      let selector = `#page${actualPage}`;
      const rect = await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) {
          return null;
        }
        var { x, y, width, height } = element.getBoundingClientRect();

        return { left: x, top: y, width, height, id: element.id };
      }, selector);

      const path = `${tempDir}/${actualPage}.png`;

      await page.waitForSelector(`#page${actualPage}`).then(async () => {
        await page.screenshot({
          path,
          clip: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
        });
      });
    });

    for (i = 1; i <= pagesNumber; i++) {
      cluster.queue(`https://es.scribd.com/embeds/${idbook}/content?start_page=${i}&view_mode=slideshow`);
    }

    // Shutdown after everything is done
    await cluster.idle();
    await cluster.close();

    createPdf(pagesNumber, docName);
    deleteTemp();
  } catch (e) {
    console.log(e);
  }
};

function createPdf(numberPages, fileName) {
  var dimensions = sizeOf("downloads/temp/1.png");
  let width = dimensions.width;
  let height = dimensions.height;
  // Create a document
  let doc;

  if (width > height) {
    doc = new PDFDocument({ layout: "landscape" });
  } else {
    doc = new PDFDocument({ layout: "portrait" });
  }

  // Pipe its output somewhere, like to a file or HTTP response
  // See below for browser usage
  doc.pipe(fs.createWriteStream(`downloads/${fileName}.pdf`));

  doc.text("").moveDown(8);
  doc
    .text("Gracias por usar mi programa", {
      align: "center",
    })
    .fontSize(12);
  doc.text("Desarrollado por: dialguiba", { align: "center" }).fontSize(12).moveDown(8);

  doc.text("Si este servicio de descarga te sirvió y gustas apoyar puedes hacerlo en:", { align: "center" }).fontSize(15).moveDown(1);
  doc
    .text(
      "https://www.buymeacoffee.com/dialguiba",

      { align: "center" }
    )
    .fontSize(15)
    .moveDown(4);
  doc
    .text("Si tienes algún problema o sugerencia: dialguiba1994@gmail.com", {
      align: "center",
    })
    .fontSize(15)
    .moveDown(1);

  // Add an image, constrain it to a given size, and center it vertically and horizontally
  /* if (width > height) {
    doc.image("downloads/temp/1.png", {
      fit: [680, 460],
      //fit: [500, 550],
      //width: 800,
      align: "center",
      valign: "center",
    });
  } else {
    doc.image("downloads/temp/1.png", {
      fit: [460, 720],
      align: "center",
      valign: "center",
    });
  } */

  //deleteFile("./1.png");

  for (i = 1; i <= numberPages; i++) {
    if (width > height) {
      doc.addPage().image(`downloads/temp/${i}.png`, {
        fit: [680, 460],
        //fit: [500, 550],
        //width: 800,
        align: "center",
        valign: "center",
      });
    } else {
      doc.addPage().image(`downloads/temp/${i}.png`, {
        fit: [460, 720],
        align: "center",
        valign: "center",
      });
    }
  }
  let finished = "finished";
  // Finalize PDF file
  doc.save();
  doc.end();
  return finished;
}

function deleteTemp() {
  const directory = "downloads/temp/";

  fs.readdir(directory, (err, files) => {
    if (err) throw err;

    for (const file of files) {
      fs.unlink(path.join(directory, file), (err) => {
        if (err) throw err;
      });
    }
  });
}
