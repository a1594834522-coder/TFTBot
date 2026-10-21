import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ensureOriginalAsset} from '../src/desktop/original-assets';
it('同版本原生 DLL 校验后复用，不重新写入已加载文件',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tft-provider-'));
  const file=path.join(dir,'fixture.dll'),bytes=Buffer.from('synthetic-test-asset');
  await ensureOriginalAsset(file,bytes);
  const write=vi.spyOn(fs,'writeFile');
  await ensureOriginalAsset(file,bytes);expect(write).not.toHaveBeenCalled();
  await expect(ensureOriginalAsset(file,Buffer.from('changed'))).rejects.toThrow('校验失败');
  write.mockRestore();
});
