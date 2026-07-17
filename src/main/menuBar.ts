import { Menu, Tray, nativeImage, type Rectangle } from 'electron'
import {
  menuBarTooltip,
  type MenuBarAction,
  type MenuBarState,
} from './menuBarModel'

export interface MenuBarControllerDeps {
  iconPath: string
  getState: () => MenuBarState
  actions: Record<MenuBarAction, () => void | Promise<void>>
}

export class MenuBarController {
  private tray: Tray | null = null
  private quitMenu: Menu | null = null

  constructor(private readonly deps: MenuBarControllerDeps) {}

  initialize(): void {
    if (this.tray) return

    this.tray = new Tray(createTrayIcon(this.deps.iconPath))
    this.tray.on('click', () => {
      void this.runAction('quickSearch')
    })
    this.tray.on('right-click', () => {
      this.showQuitMenu()
    })
    this.refresh()
  }

  refresh(): void {
    if (!this.tray) return
    const state = this.deps.getState()
    this.tray.setToolTip(menuBarTooltip(state))
    this.quitMenu = Menu.buildFromTemplate([
      {
        id: 'quit',
        label: `Quit ${state.appName}`,
        click: () => {
          void this.runAction('quit')
        },
      },
    ])
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
    this.quitMenu = null
  }

  bounds(): Rectangle | null {
    return this.tray?.getBounds() ?? null
  }

  private showQuitMenu(): void {
    this.refresh()
    this.tray?.popUpContextMenu(this.quitMenu ?? undefined)
  }

  private async runAction(action: MenuBarAction): Promise<void> {
    try {
      await this.deps.actions[action]()
    } catch (err) {
      console.error('[menu-bar] Action failed:', err instanceof Error ? err.message : String(err))
    } finally {
      this.refresh()
    }
  }
}

function createTrayIcon(path: string): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const logoIcon = createMarketingLogoTrayIcon()
    if (!logoIcon.isEmpty()) return logoIcon
  }

  const source = nativeImage.createFromPath(path)
  const icon = source.resize({ width: 18, height: 18 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  return icon.isEmpty() ? source : icon
}

function createMarketingLogoTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createEmpty()
  for (const representation of MARKETING_LOGO_REPRESENTATIONS) {
    icon.addRepresentation({
      scaleFactor: representation.scaleFactor,
      width: representation.width,
      height: representation.height,
      dataURL: `data:image/png;base64,${representation.base64}`,
    })
  }
  icon.setTemplateImage(true)
  return icon
}

const MARKETING_LOGO_REPRESENTATIONS = [
  {
    scaleFactor: 1,
    width: 18,
    height: 18,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAABX0lEQVR42q3UQUtUURgG4GdmLF0YBG0KESFaShCuwl/QUrFNrvUnuGznol8QrVq6cCUE0Q/IclHRQgmJQBGiIdQSraaZsc17Ybjc6xB14OUczrnfe97v/b5z+U+jkfkNbmAPH7EbfMIB2ugNxDXRryJcxjHOS+jjEDt4gSdYSEyrTt1qgn8HvQriAnOJGSmTNDGKZ/mwG6IC3eBX5iPcrFLTzDyBDxco6aOT9SYuK+V5HrLveI6zmN3GzxRlNN8XMZO4g7XBqrWSwn08wDY+4wu+xbMRXEl1b2MKV3G3nFoD0/hakU4bb7GBxWE9VUi+h9N40anxar6uakoHDyuCu/GrE4UTwzq9lVQfpeMPQlAmfhfPaqX1MI7XeIkfuWAs+7eC6zH7pE5RA9fwPjefYR9bePo3D7kwfTaml1Naz/mlgfYZSrZSU7Wl8sNtXUDWxKusj4OT7M/gcd2v5J/GHxt7fXuNSCHRAAAAAElFTkSuQmCC',
  },
  {
    scaleFactor: 2,
    width: 36,
    height: 36,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAADJklEQVR42u2Yu2uUQRTFf/NllRhBwmqemqCgiIIimCpYiK9G0drS1kL9E7Sz8h9QFGzsjDY2ooWgIloYEUHzNpsYNMZHXpL99lubMzAM32sfFgEvXIZdJjNn7r3n3LuB/7bOzHifh4DDQAiMyUeAUWASmAW+ZZwZyK1VgUhrzYBe6cLTMXtD4AcwB5SACWBc6xTwBZgH1lLuqtYK6BhwA1gCBgXCvthknLUCfBXYSYEdV4Rf1ALKt/NK1aj+uKLVhr4ioGV56KQkyR8BG4GWrIe1eJ83AMNAOzCgCzfrUON44LnxQPu+F9gBPAAK+i63FbTeVRH/znh9Hl/Tetm7IzfzAmAT8BT4rEhFDQCKlNoQOJqQnUzqAvQBH4HplHTUAqoKzOhcPHnINPuCQVF6XJHKc3ES4FDrS6fIU4saT9AK0pgF4AywKlB/5D7LjFPkJoZRgfb3Az3Aw1oA4bDhLfAaWJQwLqpQ/QhUnFopa0/oKXWgfQN64PM0YYyrpVM6bFhgXGsDulUTO/XyfqAX6JB8tAGtIklBQWhJwlBIARIBh4BbusAAPwVqSsI5AnxS+3gDLMdISC+wR2sfsF3epciTJ0I2/1uA2zpwX0aKy+pls2odYwI7LLANm6XkbuCd9CjyaiRv67ijs1oVtaAe2rtFf1KpWvA0pZrR58qOVNSl0mmt5ArwXZNAtQZRjBxgR+pR6TRQNwVqLUYE00DZiWEa6HT0qqHJMlDnfyaWreSMkt1jU/fYiZJpRpHvF3tmRfOyFym/4CsOKBvZ60mpM3WAiiT7Z6UnVls6gW2SCncYMwmMOgE8SaqNvGmLgKJE7p5mJX9Ph6Peu6Tc3XILPPdMnSUBFeAacEEXzutHQUk6NSEFn9CYMRMTgHatc40yzeb7nBpiKUdBlzSQmZhsmGaotwV1VZFYilHusiLpUr3ozd9NAWNfZbv1kNJVSaG/ZdX9Zql0Gv17gA/ArwzltvpzsVkqnZa64/o1u+SkKXT0xx3wV4ED/xKUDf8lsS3M0Treq+Mn1pFpQvoi4KBkYKtS2SXdKeq7ojRoSv/MWHbm9v+2vu0vjwiMv9p5RUwAAAAASUVORK5CYII=',
  },
  {
    scaleFactor: 3,
    width: 54,
    height: 54,
    base64: 'iVBORw0KGgoAAAANSUhEUgAAADYAAAA2CAYAAACMRWrdAAAFP0lEQVR42u2aTWhcVRTHf28+8lVJ29g2TfolFNRaogiK4sqN0I24Edx0IYhULShu3CjowoLoTii6KKJi8QO/sEuNglSwXYkpVLRp0zSJsWljqqnpzLyZ58L/wctjPt5M7nvJYg4c7swjc+/533PvOf9zXqArXelKmhI0eP4ecA+wHZgBLgC/Ss8DF4F54HqL+fOxNWpApM/RWgC7BBwFXpVxcfkHWABmgWmBvQBMAnPA78BfLdbOSQ1k5BN0I2A/AzeA74AXgLKz+0GT35ksyKNT0t8EfErPr7Yw3kBXOwXZyMCtwC/AD/r+sBbJ19nhqIEXGsmSPDojD5unp/XsqjYyNblTRr8jkJGzg820Jq0CIVCRhgl++7dAjgPPA4WEJySxFDQ+qgXf152JnADQqTYCXW/eLxx7vIEranxFhnyssbpKYElBl/Tstdhme/XclwoIJ9s4kj5AVvT5Md/gAgWMXt2z84qYWYILlS/HnNzoRSzK7QaWge8VyXzctyRa1TpngY2yx9t9s116UIud1C5mBa6s8dM079tTWmS8STRLQy2YvJgGOIuUbwMrSuBu7nI1LXA1EQbvwcQm+1FsYTwBEF/ALZj8CdzaLJgEHQaTCNisCHkNuAIMCfSAxg1AnyJqK4nasM2o3QRwvzhtzQcwOwIhcLsS920OaQ1FjUpaNNQ6EdCv4zwgwL1AT5vAA81ZAI4DB315rJ6MAbcoJewBdkq3ypMDDi0qy7AVJWBjM8YJiwLcL48XG9hpnnsJOOIL2F5xxyUZ10xuBrYJ6A5nA0ZVyA4Bg/JcTsBL0tABUXDIQo/GmoAXVwMsrwWeA17WxLMqLC+p1ppW8p5RaXItwbyDwLB0D7BL4HcCI8AW/c2AbMgLUE5Hvqy/WTWwrzXeISPqSai6al5greA00PPAZXmllfTL66OOx3dIC8BbwLc+gD0CfAh8InIa72skKTaXgT/k7SmnvWDF5qy8EaTdG4lTq9d1x040IMSrKTbLahYd0XoFZ7Pse8E5lnnfCfobVbtnOmD79UBX6szxZhr0qVWjZaOO0oTuiy9CbKCNGx7MEpy5/27t9CmHAfguNJfTqMWSsP3HZcSpFApQm2vCCfdBluCOamcnUgBXcRpKmR3JwKFKpxWyJ2WIz1rNCs3DWQeTQAlzSa2DuYQlTLvlShm4L8v7Zos8JEM+052bARbV6w/bAFGvdrPjPaWSqWkj1RfqSMfjnIA8LXKbd+5JWX2S6/q84hBeMz5wTkD8PUEgcJuB/cBHzZiJ7whTFIh9wAPid7tUvgw7hNbYfF6erCpdVGJ9+7zm7HPYRigC/iRwzKkN60Y1X2IlzFlpXHq04yMqZXbrbo5o3CbCO+gUpblYWWKnYF8nb1s6CSA14F7t5BXxvTnds8t6loTNb3BKmVHH6yP6PKKu9CGR5sBna6DePDkFjV7gQB02vyCdk0FWw9mLwsWE9VumYkHomLpWx2P5p5WuqFQ5rb6h3a1CTPOxAJNJog5Eey7Kc5OxFrWx+SSvj97IMhEn7fGPKcJ9Lk/U2shdoePlA1km4qTc8VCsU1zt4CXEvAJIkoo8U3AfqPw/10GtZizlxHo6kvZOrY//3qlNKtp1yuqfXa/3raRWeLXDPv0N4K7YvOviSD4hI39SYKi2cSztSJ5RxM0szCcF966O1qLjuVoMQEXercTAV2KNnURRMu1QGmmXv9JO96ltV5LxRdngtteMCFvu69E8+wWulMRrwRoFF+ODQyK9w+KA251xk6qBLcBNYjXP8P8/m3WlK11ZQ/kX7zaB+2fqsXwAAAAASUVORK5CYII=',
  },
] as const
