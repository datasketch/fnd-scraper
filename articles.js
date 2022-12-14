const axios = require('axios')
const puppeteer = require('puppeteer')
const fs = require('fs')
const path = require('path')
const { format, parseISO } = require('date-fns')

const file = path.join(__dirname, 'data', 'articles.json')

const endpoint = 'https://api.queryly.com/json.aspx?queryly_key=06e63be824464567&query=didier%20tavera%20&endindex={{PAGE}}&batchsize=20&callback=searchPage.resultcallback&showfaceted=true&timezoneoffset=300'

async function getURLs () {
  const results = []

  let collect = true
  let index = 0
  let page = 20 * index

  while (collect) {
    const response = await axios.get(endpoint.replace('{{PAGE}}', page))
    const responseText = response.data.trim()
    const re = /"items":(\[.*?\])/
    const match = responseText.match(re)
    if (!match) {
      break
    }
    const [, itemsText] = match
    const items = JSON.parse(itemsText || [])
    if (!items.length) {
      collect = false
    } else {
      const links = items.map(item => item.link)
      results.push(...links)

      index += 1
      page = 20 * index
    }
  }
  return results
}

(async () => {
  const urls = await getURLs()
  const browser = await puppeteer.launch(/* { headless: false } */)
  const page = await browser.newPage()

  const results = []
  let missing = 0
  let warnings = 0
  const total = urls.length

  for (let index = 0; index < total; index++) {
    console.log(`Processing ${index + 1} / ${total}`)
    const url = urls[index]
    const completeURL = 'https://www.semana.com' + url
    const response = await page.goto(completeURL, {
      timeout: 60000
    })
    if (response.status() === 404) {
      missing += 1
      console.log('Not found X')
      console.log('\n')
      continue
    }
    const data = await page.evaluate((completeURL) => {
      const overlineText = document.querySelector('h3.overlineText ')?.textContent ?? ''
      // Si no es columna de opinión, ignorar
      if (overlineText !== 'opinión') {
        return {}
      }
      const author = document.querySelector('div.section.sp-8')?.textContent ?? ''
      // Si el nombre del autor no contiene Didier, ignorar
      if (!author.includes('Didier')) {
        return {}
      }
      const title = document.querySelector('.article-box-opinion h2')
      const excerpt = document.querySelector('h2.h2')?.textContent ?? ''
      const publishedDate = document.querySelector('.datetime')?.textContent ?? ''
      const [day, month, year] = publishedDate.split('/')
      const content = Array.from(document.querySelectorAll('article.paywall p.section.sp-8'))
      return {
        title: title?.textContent ?? '',
        excerpt,
        publishedDate: publishedDate ? new Date(+year, +month - 1, +day).toISOString() : '',
        content: content.length ? content.reduce((result, p) => result + `<p>${p.innerHTML}</p>`, '') : '',
        scope: overlineText,
        link: completeURL
      }
    }, completeURL)
    if (!data.title || !data.content) {
      warnings += 1
      console.log('I could\'t find the title or content 🤔')
      console.log('\n')
      continue
    }
    if (data.publishedDate) {
      data.publishedDate = format(parseISO(data.publishedDate), 'yyyy-MM-dd')
    }
    results.push(data)
    console.log('Processed ✓')
    console.log('\n')
  }
  await browser.close()
  fs.writeFileSync(file, JSON.stringify(results), 'utf8')
  console.log(`✓ ${results.length} entries saved`)
  console.log(`⚠ ${warnings} entries omitted because title is missing`)
  console.log(`X ${missing} missing pages`)
})()
