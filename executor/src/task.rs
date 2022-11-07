use core::iter;
use jsonrpsee::core::client::Client;
use serde::{Deserialize, Serialize};
use smoldot::{
    executor::{
        host::{Config, HeapPages, HostVmPrototype},
        runtime_host::{self, RuntimeHostVm},
        storage_diff::StorageDiff,
    },
    json_rpc::methods::HexString,
};

use crate::runner_api::RpcApiClient;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskCall {
	wasm: HexString,
	block_hash: HexString,
	calls: Option<Vec<(String, HexString)>>,
	mock_signature_host: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Task {
    Call(TaskCall),
    RuntimeVersion {
		wasm: HexString,
	},
	CalculateStateRoot {
		entries: Vec<(HexString, HexString)>,
	},
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CallResponse {
    result: HexString,
    storage_diff: Vec<(HexString, Option<HexString>)>,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum TaskResponse {
    Call(CallResponse),
    RuntimeVersion(HexString),
	CalculateStateRoot(HexString),
    Error(String),
}

// starts with 0xdeadbeef and then rest filled by 0xcd
fn is_magic_signature(signature: &[u8]) -> bool {
	signature.starts_with(&[0xde, 0xad, 0xbe, 0xef]) && signature[4..].iter().all(|&b| b == 0xcd)
}

impl Task {
    pub async fn run(&self, task_id: u32, client: &Client) -> Result<TaskResponse, jsonrpsee::core::Error> {
        let resp = match self {
            Task::Call(call) => Task::call(task_id, client, call).await,
            Task::RuntimeVersion { wasm } => Task::runtime_version(task_id, client, wasm).await,
			Task::CalculateStateRoot { entries } => Task::calculate_state_root(task_id, client, entries).await,
        }?;

        client.task_result(task_id, &resp).await?;

        Ok(resp)
    }

    async fn call(
        task_id: u32,
        client: &Client,
		task_params: &TaskCall
    ) -> Result<TaskResponse, jsonrpsee::core::Error> {
        let mut storage_top_trie_changes = StorageDiff::empty();
        let mut offchain_storage_changes = StorageDiff::empty();

        let vm_proto = HostVmPrototype::new(Config {
            module: &task_params.wasm,
            heap_pages: HeapPages::from(2048),
            exec_hint: smoldot::executor::vm::ExecHint::Oneshot,
            allow_unresolved_imports: false,
        })
        .unwrap();
        let mut ret: Result<Vec<u8>, String> = Ok(Vec::new());

        for (call, params) in task_params.calls.as_ref().unwrap() {
            let mut vm = runtime_host::run(runtime_host::Config {
                virtual_machine: vm_proto.clone(),
                function_to_call: &call,
                parameter: iter::once(params.as_ref()),
                top_trie_root_calculation_cache: None,
                storage_top_trie_changes,
                offchain_storage_changes,
            })
            .unwrap();

            println!("Calling {}", call);

            let res = loop {
                vm = match vm {
                    RuntimeHostVm::Finished(res) => {
                        break res;
                    }
                    RuntimeHostVm::StorageGet(req) => {
                        let key = req.key().as_ref().to_vec();
                        let mut value = client
                            .storage_get(task_id, &task_params.block_hash, HexString(key))
                            .await?;
                        if let Some(val) = &value {
                            if val.0.is_empty() {
                                value = None;
                            }
                        }
                        req.inject_value(value.map(|v| iter::once(v.0)))
                    }
                    RuntimeHostVm::PrefixKeys(req) => {
                        let prefix = req.prefix().as_ref().to_vec();
                        if prefix.is_empty() {
                            // this must be coming from `ExternalStorageRoot` trying to get all keys in order to calculate storage root digest
                            // we are not going to fetch all the storages for that, so a dummy value is returned
                            // this means the storage root digest will be wrong, and failed the final check
                            // so we should just avoid doing final check by not supporting execute_block
                            req.inject_keys_ordered(iter::empty::<Vec<u8>>())
                        } else {
                            let keys = client
                                .prefix_keys(task_id, &task_params.block_hash, HexString(prefix))
                                .await?;
                            req.inject_keys_ordered(keys.into_iter().map(|v| v.0))
                        }
                    }
                    RuntimeHostVm::NextKey(req) => {
                        let key = req.key().as_ref().to_vec();
                        let next_key = client
                            .next_key(task_id, &task_params.block_hash, HexString(key))
                            .await?;
                        req.inject_key(next_key.map(|k| k.0))
                    }
					RuntimeHostVm::SignatureVerification(req) => {
						let bypass = task_params.mock_signature_host && is_magic_signature(req.signature().as_ref());
						if bypass {
							req.resume_success()
						} else {
							req.verify_and_resume()
						}
					}
                }
            };

            println!("Completed {}", call);

            match res {
                Ok(success) => {
                    ret = Ok(success.virtual_machine.value().as_ref().to_vec());

                    storage_top_trie_changes = success.storage_top_trie_changes;
                    offchain_storage_changes = success.offchain_storage_changes;
                }
                Err(err) => {
                    ret = Err(err.to_string());
                    storage_top_trie_changes = StorageDiff::empty();
                    break;
                }
            }
        }

        Ok(ret.map_or_else(
            |err| TaskResponse::Error(err),
            move |ret| {
                let diff = storage_top_trie_changes
                    .diff_into_iter_unordered()
                    .map(|(k, v)| (HexString(k), v.map(HexString)))
                    .collect();

                TaskResponse::Call(CallResponse {
                    result: HexString(ret),
                    storage_diff: diff,
                })
            },
        ))
    }

    async fn runtime_version(
        _task_id: u32,
        _client: &Client,
		wasm: &HexString,
    ) -> Result<TaskResponse, jsonrpsee::core::Error> {
        let vm_proto = HostVmPrototype::new(Config {
            module: &wasm,
            heap_pages: HeapPages::from(2048),
            exec_hint: smoldot::executor::vm::ExecHint::Oneshot,
            allow_unresolved_imports: false,
        })
        .unwrap();

        let resp = vm_proto.runtime_version();

        Ok(TaskResponse::RuntimeVersion(HexString(
            resp.as_ref().to_vec(),
        )))
    }


	async fn calculate_state_root(
		_task_id: u32,
        _client: &Client,
		_entries: &Vec<(HexString, HexString)>,
	) -> Result<TaskResponse, jsonrpsee::core::Error> {
		Ok(TaskResponse::CalculateStateRoot(HexString(vec![0u8; 32])))
	}
}

#[test]
fn is_magic_signature_works() {
	assert!(is_magic_signature(&[0xde, 0xad, 0xbe, 0xef, 0xcd, 0xcd]));
	assert!(is_magic_signature(&[
		0xde, 0xad, 0xbe, 0xef, 0xcd, 0xcd, 0xcd, 0xcd
	]));
	assert!(!is_magic_signature(&[
		0xde, 0xad, 0xbe, 0xef, 0xcd, 0xcd, 0xcd, 0x00
	]));
	assert!(!is_magic_signature(&[
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
	]));
}
